import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { depositSchema } from '../validators/wallet';
import * as walletController from '../controllers/walletController';

export const walletRoutes = Router();

walletRoutes.use(authenticate);
walletRoutes.get('/', walletController.getWallet);
walletRoutes.post('/deposit', validate(depositSchema), walletController.deposit);
