import { createHash } from 'crypto';
import type { Request } from 'express';
import { Prisma, type Transaction, type TxType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middleware/errorHandler';
import { StatusCode } from '../constants/statusCode';

// Matches the VarChar(100) column.
const MAX_KEY_LENGTH = 100;

/** Wallet movement produced by the operation; the helper adds the bookkeeping fields. */
export interface TransactionData {
  amount: number;
  fromWalletId?: number;
  toWalletId?: number;
}

export interface IdempotentRequest {
  userId: number;
  key: string;
  type: TxType;
  payload: unknown;
}

/** JSON with object keys sorted recursively, so equal payloads always hash equally. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashRequest = (type: TxType, payload: unknown): string =>
  createHash('sha256')
    .update(type + canonicalJson(payload))
    .digest('hex');

/**
 * Reads the `Idempotency-Key` header.
 *
 * @throws {AppError} 400 if the header is missing, empty or longer than 100 characters.
 */
export const getIdempotencyKey = (req: Request): string => {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key) {
    throw new AppError(
      StatusCode.BAD_REQUEST,
      'MISSING_IDEMPOTENCY_KEY',
      'Idempotency-Key header is required',
    );
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new AppError(
      StatusCode.BAD_REQUEST,
      'INVALID_IDEMPOTENCY_KEY',
      `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`,
    );
  }
  return key;
};

const findExisting = (userId: number, key: string): Promise<Transaction | null> =>
  prisma.transaction.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
  });

/** Returns the stored transaction for the same request, or rejects a key reused with a different one. */
const replay = (existing: Transaction, requestHash: string): Transaction => {
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      StatusCode.UNPROCESSABLE_ENTITY,
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was already used with a different request',
    );
  }
  return existing;
};

/**
 * Runs a money operation at most once per (userId, key).
 *
 * `work` executes inside a `prisma.$transaction` and returns the wallet movement; the Transaction
 * row is created in that same database transaction, so the balance change and the record commit or
 * roll back together. A repeat of the same request returns the stored transaction without calling
 * `work`. Concurrent duplicates are settled by the unique (userId, idempotencyKey) index: the loser
 * gets P2002, rolls back and replays the winner's row.
 *
 * @throws {AppError} 422 if the key was already used with a different type or payload.
 */
export const runIdempotent = async (
  { userId, key, type, payload }: IdempotentRequest,
  work: (tx: Prisma.TransactionClient) => Promise<TransactionData>,
): Promise<Transaction> => {
  const requestHash = hashRequest(type, payload);

  const existing = await findExisting(userId, key);
  if (existing) return replay(existing, requestHash);

  try {
    return await prisma.$transaction(async (tx) => {
      const data = await work(tx);
      return tx.transaction.create({
        data: { ...data, type, userId, idempotencyKey: key, requestHash },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await findExisting(userId, key);
      if (winner) return replay(winner, requestHash);
    }
    throw err;
  }
};
