import { Prisma, type User } from '@prisma/client';
import { prisma } from '../config/prisma';

/** Thrown when a user with the same email already exists. */
export class DuplicateEmailError extends Error {}

/**
 * Finds a user by email.
 *
 * @returns The user, or null if none exists.
 */
export const findByEmail = (email: string): Promise<User | null> =>
  prisma.user.findUnique({ where: { email } });

/**
 * Creates a user and an empty wallet atomically in a single transaction.
 *
 * @returns The created user.
 * @throws {DuplicateEmailError} If the email is already taken.
 */
export const createWithWallet = async (data: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<User> => {
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      await tx.wallet.create({ data: { userId: user.id } });
      return user;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateEmailError();
    }
    throw err;
  }
};
