import bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import * as userRepository from '../repositories/userRepository';
import { AppError } from '../middleware/errorHandler';
import { StatusCode } from '../constants/statusCode';
import type { LoginInput, RegisterInput } from '../validators/auth';
import { signToken } from './tokenService';

const SALT_ROUNDS = 10;

// Compared against when the email is unknown so response time doesn't reveal which emails exist
const DUMMY_HASH = bcrypt.hashSync('dummy-password', SALT_ROUNDS);

export type PublicUser = Pick<User, 'id' | 'name' | 'email' | 'createdAt'>;

export interface AuthResult {
  user: PublicUser;
  token: string;
}

/** Selects the user fields that are safe to expose to clients. Never includes `passwordHash`. */
const publicUser = (user: User): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt,
});

/**
 * Registers a new user with an empty wallet.
 *
 * @throws {AppError} 409 if the email is already registered.
 */
export const register = async ({ name, email, password }: RegisterInput): Promise<AuthResult> => {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const user = await userRepository.createWithWallet({ name, email, passwordHash });
    return { user: publicUser(user), token: signToken(user.id) };
  } catch (err) {
    if (err instanceof userRepository.DuplicateEmailError) {
      throw new AppError(StatusCode.CONFLICT, 'EMAIL_TAKEN', 'Email is already registered');
    }
    throw err;
  }
};

/**
 * Authenticates a user by email and password.
 *
 * @throws {AppError} 401 with one generic message for an unknown email or a wrong password.
 */
export const login = async ({ email, password }: LoginInput): Promise<AuthResult> => {
  const user = await userRepository.findByEmail(email);
  const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !valid)
    throw new AppError(StatusCode.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password');

  return { user: publicUser(user), token: signToken(user.id) };
};
