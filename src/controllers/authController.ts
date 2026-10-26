import type { Request, Response } from 'express';
import * as authService from '../services/authService';
import { StatusCode } from '../constants/statusCode';

/** POST /api/auth/register - Creates an account and responds 201 with the user and a token. */
export const register = async (req: Request, res: Response): Promise<void> => {
  const result = await authService.register(req.body);
  res.status(StatusCode.CREATED).json(result);
};

/** POST /api/auth/login - Verifies credentials and responds 200 with the user and a token. */
export const login = async (req: Request, res: Response): Promise<void> => {
  const result = await authService.login(req.body);
  res.status(StatusCode.OK).json(result);
};
