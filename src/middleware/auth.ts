import type { RequestHandler } from 'express';
import { AppError } from './errorHandler';
import { verifyToken } from '../services/tokenService';
import { StatusCode } from '../constants/statusCode';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: number };
    }
  }
}

/** Creates the standard 401 error. */
const unauthorized = (message: string): AppError =>
  new AppError(StatusCode.UNAUTHORIZED, 'UNAUTHORIZED', message);

/**
 * Authenticates a request from its `Authorization: Bearer <token>` header and sets
 * `req.user = { id }`. A missing, invalid or expired token results in a 401.
 */
export const authenticate: RequestHandler = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token)
    return next(unauthorized('Missing or malformed Authorization header'));

  try {
    const payload = verifyToken(token);
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) return next(unauthorized('Invalid token'));
    req.user = { id };
    next();
  } catch (err) {
    const expired = err instanceof Error && err.name === 'TokenExpiredError';
    next(unauthorized(expired ? 'Token expired' : 'Invalid token'));
  }
};
