import { z } from 'zod';

export const MAX_AMOUNT = 100_000_000;

export const depositSchema = z.object({
  amount: z.number().int().positive().max(MAX_AMOUNT),
});

export const withdrawSchema = depositSchema;

// Wallet.id is a 32-bit Int.
export const transferSchema = z.object({
  toWalletId: z.number().int().positive().max(2_147_483_647),
  amount: z.number().int().positive().max(MAX_AMOUNT),
});

export const MAX_PAGE_SIZE = 100;

// Capped so (page - 1) * limit stays inside the 32-bit `skip` Prisma accepts.
export const transactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawInput = z.infer<typeof withdrawSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;
