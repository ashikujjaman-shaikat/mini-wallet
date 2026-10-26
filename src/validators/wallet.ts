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

export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawInput = z.infer<typeof withdrawSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
