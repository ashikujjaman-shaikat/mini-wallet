import type { Transaction, Wallet } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middleware/errorHandler';
import { StatusCode } from '../constants/statusCode';
import type { DepositInput, WithdrawInput } from '../validators/wallet';
import { runIdempotent } from './idempotency';

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
