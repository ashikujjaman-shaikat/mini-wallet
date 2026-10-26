import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { StatusCode } from '../constants/statusCode';

/** Operational error carrying an HTTP status and a machine-readable code. */
export class AppError extends Error {
  /**
   * @param status - HTTP status code.
   * @param code - Stable error code returned to clients.
   * @param message - Human-readable description.
   */
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Writes the standard `{ error: { code, message } }` response. */
const sendError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ error: { code, message } });
};

/** Forwards a 404 AppError for any request that matched no route. */
export const notFound: RequestHandler = (req, res, next) => {
  next(new AppError(StatusCode.NOT_FOUND, 'NOT_FOUND', 'Route not found'));
};

/**
 * Centralized error middleware. Maps AppError, ZodError and JSON parse failures to their
 * status codes and responds with `{ error: { code, message } }`. Anything else is a 500.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return sendError(res, err.status, err.code, err.message);
  }

  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return sendError(res, StatusCode.BAD_REQUEST, 'VALIDATION_ERROR', message);
  }

  if (err?.type === 'entity.parse.failed') {
    return sendError(res, StatusCode.BAD_REQUEST, 'INVALID_JSON', 'Malformed JSON body');
  }

  if (process.env.NODE_ENV !== 'test') console.error(err);
  return sendError(
    res,
    StatusCode.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    'Internal server error',
  );
};
