import type { Request, Response } from 'express';
import * as walletService from '../services/walletService';
import { getIdempotencyKey } from '../services/idempotency';
import { StatusCode } from '../constants/statusCode';

/** GET /api/wallet - Responds 200 with the authenticated user's wallet. */
export const getWallet = async (req: Request, res: Response): Promise<void> => {
  const wallet = await walletService.getWallet(req.user!.id);
  res.status(StatusCode.OK).json(wallet);
};

/** POST /api/wallet/deposit - Responds 201 with the deposit transaction (also on an idempotent replay). */
export const deposit = async (req: Request, res: Response): Promise<void> => {
  const key = getIdempotencyKey(req);
  const transaction = await walletService.deposit(req.user!.id, key, req.body);
  res.status(StatusCode.CREATED).json(transaction);
};
