import jwt, { type JwtPayload } from 'jsonwebtoken';

/**
 * Reads the JWT secret from the environment.
 *
 * @throws If `JWT_SECRET` is not set.
 */
const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
};

/**
 * Signs a JWT whose subject is the user id.
 *
 * @returns Signed token, valid for one day.
 */
export const signToken = (userId: number): string =>
  jwt.sign({}, getSecret(), { subject: String(userId), expiresIn: '1d', algorithm: 'HS256' });

/**
 * Verifies a JWT's signature and expiry.
 *
 * @returns Decoded payload.
 * @throws If the token is invalid or expired.
 */
export const verifyToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  if (typeof payload === 'string') throw new jwt.JsonWebTokenError('Invalid token payload');
  return payload;
};
