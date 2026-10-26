import type { Request, Response } from 'express';
import * as walletService from '../services/walletService';
import { getIdempotencyKey } from '../services/idempotency';
import { StatusCode } from '../constants/statusCode';
import { transactionsQuerySchema } from '../validators/wallet';

/** GET /api/wallet - Responds 200 with the authenticated user's wallet. */
export const getWallet = async (req: Request, res: Response): Promise<void> => {
  const wallet = await walletService.getWallet(req.user!.id);
  res.status(StatusCode.OK).json(wallet);
};

/** GET /api/wallet/transactions?page=&limit= - Responds 200 with `{ data, page, limit, total }`. */
export const listTransactions = async (req: Request, res: Response): Promise<void> => {
  const query = transactionsQuerySchema.parse(req.query);
  const result = await walletService.listTransactions(req.user!.id, query);
  res.status(StatusCode.OK).json(result);
};

/** POST /api/wallet/deposit - Responds 201 with the deposit transaction (also on an idempotent replay). */
export const deposit = async (req: Request, res: Response): Promise<void> => {
  const key = getIdempotencyKey(req);
  const transaction = await walletService.deposit(req.user!.id, key, req.body);
  res.status(StatusCode.CREATED).json(transaction);
};

/** POST /api/wallet/withdraw - Responds 201 with the withdrawal transaction (also on an idempotent replay). */
export const withdraw = async (req: Request, res: Response): Promise<void> => {
  const key = getIdempotencyKey(req);
  const transaction = await walletService.withdraw(req.user!.id, key, req.body);
  res.status(StatusCode.CREATED).json(transaction);
};

/** POST /api/wallet/transfer - Responds 201 with the transfer transaction (also on an idempotent replay). */
export const transfer = async (req: Request, res: Response): Promise<void> => {
  const key = getIdempotencyKey(req);
  const transaction = await walletService.transfer(req.user!.id, key, req.body);
  res.status(StatusCode.CREATED).json(transaction);
};
