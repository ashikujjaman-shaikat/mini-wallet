import rateLimit from 'express-rate-limit';
import { AppError } from './errorHandler';
import { StatusCode } from '../constants/statusCode';

/** Limits each IP to 20 requests per 15 minutes on the auth routes. Disabled in tests. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  // Responds with a 429 in the standard error format.
  handler: (req, res, next) =>
    next(
      new AppError(
        StatusCode.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many requests, please try again later',
      ),
    ),
});
