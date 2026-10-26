import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { depositSchema, transferSchema, withdrawSchema } from '../validators/wallet';
import * as walletController from '../controllers/walletController';

export const walletRoutes = Router();

walletRoutes.use(authenticate);
walletRoutes.get('/', walletController.getWallet);
walletRoutes.get('/transactions', walletController.listTransactions);
walletRoutes.post('/deposit', validate(depositSchema), walletController.deposit);
walletRoutes.post('/withdraw', validate(withdrawSchema), walletController.withdraw);
walletRoutes.post('/transfer', validate(transferSchema), walletController.transfer);
