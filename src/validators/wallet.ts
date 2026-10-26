import { z } from 'zod';

export const MAX_AMOUNT = 100_000_000;

export const depositSchema = z.object({
  amount: z.number().int().positive().max(MAX_AMOUNT),
});

export const withdrawSchema = depositSchema;

export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawInput = z.infer<typeof withdrawSchema>;
