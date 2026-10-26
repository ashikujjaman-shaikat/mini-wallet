import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true, quiet: true });

  // Tests wipe tables, so refuse to run against anything that isn't clearly a test DB
  const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests against non-test database "${dbName}"`);
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });
}
