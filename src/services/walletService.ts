import { Prisma, type Transaction, type Wallet } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middleware/errorHandler';
import { StatusCode } from '../constants/statusCode';
import type {
  DepositInput,
  TransactionsQuery,
  TransferInput,
  WithdrawInput,
} from '../validators/wallet';
import { runIdempotent } from './idempotency';

const MAX_DEADLOCK_RETRIES = 3;

export type PublicTransaction = Omit<Transaction, 'requestHash'>;

/** Drops internal fields so replays and first runs serialize identically. */
const publicTransaction = ({
  requestHash: _requestHash,
  ...rest
}: Transaction): PublicTransaction => rest;

/**
 * Returns the user's wallet.
 *
 * @throws {AppError} 404 if the user has no wallet.
 */
export const getWallet = async (userId: number): Promise<Wallet> => {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new AppError(StatusCode.NOT_FOUND, 'WALLET_NOT_FOUND', 'Wallet not found');
  return wallet;
};

export type TransactionListItem = Omit<Transaction, 'requestHash' | 'idempotencyKey'> & {
  direction: 'IN' | 'OUT';
};

export interface TransactionPage {
  data: TransactionListItem[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Lists the transactions that involve the user's wallet, newest first.
 *
 * `direction` is IN when the wallet is the receiver and OUT otherwise. A wallet can't transfer to
 * itself, so a row is never both. The idempotency fields are omitted because the counterparty's
 * key must not be exposed.
 */
export const listTransactions = async (
  userId: number,
  { page, limit }: TransactionsQuery,
): Promise<TransactionPage> => {
  const wallet = await getWallet(userId);
  const where: Prisma.TransactionWhereInput = {
    OR: [{ fromWalletId: wallet.id }, { toWalletId: wallet.id }],
  };

  const [total, rows] = await prisma.$transaction([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const data = rows.map(
    ({ requestHash: _requestHash, idempotencyKey: _idempotencyKey, ...rest }) => ({
      ...rest,
      direction: rest.toWalletId === wallet.id ? ('IN' as const) : ('OUT' as const),
    }),
  );
  return { data, page, limit, total };
};

/** Adds `amount` to the user's wallet, at most once per idempotency key. */
export const deposit = async (
  userId: number,
  key: string,
  { amount }: DepositInput,
): Promise<PublicTransaction> => {
  const transaction = await runIdempotent(
    { userId, key, type: 'DEPOSIT', payload: { amount } },
    async (tx) => {
      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amount } },
      });
      return { amount, toWalletId: wallet.id };
    },
  );
  return publicTransaction(transaction);
};

/**
 * Subtracts `amount` from the user's wallet, at most once per idempotency key.
 *
 * The balance check and decrement are one conditional UPDATE, so concurrent withdrawals can't
 * overdraw the wallet.
 *
 * @throws {AppError} 400 INSUFFICIENT_BALANCE if the balance is lower than `amount`.
 */
export const withdraw = async (
  userId: number,
  key: string,
  { amount }: WithdrawInput,
): Promise<PublicTransaction> => {
  const transaction = await runIdempotent(
    { userId, key, type: 'WITHDRAW', payload: { amount } },
    async (tx) => {
      const result = await tx.wallet.updateMany({
        where: { userId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (result.count !== 1) {
        throw new AppError(StatusCode.BAD_REQUEST, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
      }
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId }, select: { id: true } });
      return { amount, fromWalletId: wallet.id };
    },
  );
  return publicTransaction(transaction);
};

/** Re-runs `fn` when MySQL aborts it as a deadlock victim (Prisma P2034). */
const withDeadlockRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
  for (let retries = 0; ; retries++) {
    try {
      return await fn();
    } catch (err) {
      const deadlock = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (!deadlock || retries >= MAX_DEADLOCK_RETRIES) throw err;
    }
  }
};

/**
 * Moves `amount` from the user's wallet to `toWalletId`, at most once per idempotency key.
 *
 * Both wallet rows are locked in ascending id order, so opposite transfers can't deadlock. The
 * debit is a conditional UPDATE; a missing receiver rolls the debit back.
 *
 * @throws {AppError} 400 SAME_WALLET, 400 INSUFFICIENT_BALANCE or 404 RECEIVER_NOT_FOUND.
 */
export const transfer = async (
  userId: number,
  key: string,
  { toWalletId, amount }: TransferInput,
): Promise<PublicTransaction> => {
  const sender = await getWallet(userId);
  if (sender.id === toWalletId) {
    throw new AppError(StatusCode.BAD_REQUEST, 'SAME_WALLET', 'Cannot transfer to the same wallet');
  }

  const transaction = await withDeadlockRetry(() =>
    runIdempotent(
      { userId, key, type: 'TRANSFER', payload: { toWalletId, amount } },
      async (tx) => {
        const [firstId, secondId] = [sender.id, toWalletId].sort((a, b) => a - b);
        await tx.$queryRaw`SELECT id FROM Wallet WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE`;

        const debit = await tx.wallet.updateMany({
          where: { id: sender.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (debit.count !== 1) {
          throw new AppError(
            StatusCode.BAD_REQUEST,
            'INSUFFICIENT_BALANCE',
            'Insufficient balance',
          );
        }

        const credit = await tx.wallet.updateMany({
          where: { id: toWalletId },
          data: { balance: { increment: amount } },
        });
        if (credit.count !== 1) {
          throw new AppError(
            StatusCode.NOT_FOUND,
            'RECEIVER_NOT_FOUND',
            'Receiver wallet not found',
          );
        }

        return { amount, fromWalletId: sender.id, toWalletId };
      },
    ),
  );
  return publicTransaction(transaction);
};
