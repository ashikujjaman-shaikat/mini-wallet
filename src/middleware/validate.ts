import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/**
 * Validates `req.body` against a zod schema and replaces it with the parsed data.
 * Validation failures are passed to the error middleware as a ZodError.
 *
 * @param schema - Schema describing the expected body.
 */
export const validate =
  (schema: ZodType): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
