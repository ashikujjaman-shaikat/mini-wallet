import type { Transaction, Wallet } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middleware/errorHandler';
import { StatusCode } from '../constants/statusCode';
import type { DepositInput } from '../validators/wallet';
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
