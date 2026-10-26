import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authRateLimiter } from '../middleware/rateLimiter';
import { registerSchema, loginSchema } from '../validators/auth';
import * as authController from '../controllers/authController';

export const authRoutes = Router();

authRoutes.use(authRateLimiter);
authRoutes.post('/register', validate(registerSchema), authController.register);
authRoutes.post('/login', validate(loginSchema), authController.login);
