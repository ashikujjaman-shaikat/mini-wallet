# Mini Wallet

A small wallet API: user registration and login with JWT, each user getting one wallet, balance lookup and idempotent deposits and withdrawals. Transfer comes in a later step.

## Stack

Node.js, Express 5, TypeScript, MySQL 8, Prisma, JWT, zod, bcrypt, Jest + Supertest.

## Getting started

Requires Node.js 20+ and Docker.

```bash
npm install
cp .env.example .env          # then set JWT_SECRET
docker compose up -d          # MySQL 8 on localhost:3308
npx prisma migrate deploy     # apply migrations
npm run dev                   # http://localhost:3000
```

### Environment variables

| Variable       | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `DATABASE_URL` | MySQL connection string (default points at the Docker service) |
| `JWT_SECRET`   | Secret used to sign JWTs                                       |
| `PORT`         | HTTP port (default `3000`)                                     |

Tests read `.env.test`, which points at a separate `mini_wallet_test` database.

## Scripts

| Script                              | Purpose                                     |
| ----------------------------------- | ------------------------------------------- |
| `npm run dev`                       | Start with auto-reload (`tsx` + `nodemon`)  |
| `npm run build` / `npm start`       | Compile to `dist/` and run the compiled app |
| `npm test`                          | Run Jest (creates and migrates the test DB) |
| `npm run typecheck`                 | Type-check without emitting                 |
| `npm run lint` / `npm run lint:fix` | ESLint                                      |
| `npm run format` / `format:check`   | Prettier                                    |

A Husky pre-commit hook runs `lint-staged` (ESLint + Prettier on staged files) and the type-check.

## API

| Method | Endpoint               | Auth | Body                        |
| ------ | ---------------------- | ---- | --------------------------- |
| GET    | `/health`              | No   | none                        |
| POST   | `/api/auth/register`   | No   | `{ name, email, password }` |
| POST   | `/api/auth/login`      | No   | `{ email, password }`       |
| GET    | `/api/wallet`          | Yes  | none                        |
| POST   | `/api/wallet/deposit`  | Yes  | `{ amount }`                |
| POST   | `/api/wallet/withdraw` | Yes  | `{ amount }`                |

- Passwords are 8 to 72 characters.
- Register returns `201` with `{ user, token }`; login returns `200` with `{ user, token }`.
- Send the token as `Authorization: Bearer <token>` on protected routes.
- The auth routes are limited to 20 requests per 15 minutes per IP.
- `GET /api/wallet` returns the logged-in user's wallet (derived from the token).
- `POST /api/wallet/deposit` returns `201` with the transaction. `amount` must be a positive integer, at most `100000000`.
- `POST /api/wallet/withdraw` takes the same body and returns `201` with the transaction. A balance below `amount` returns `400 INSUFFICIENT_BALANCE`. The check and decrement are one conditional `UPDATE`, so parallel withdrawals can't overdraw.

### Idempotency

Money endpoints require an `Idempotency-Key` header (max 100 characters), unique per operation.

- Missing key: `400 MISSING_IDEMPOTENCY_KEY`.
- Same key and same request: the stored transaction is returned and nothing is executed again.
- Same key with a different request: `422 IDEMPOTENCY_KEY_REUSED`.
- The `Transaction` row is created in the same database transaction as the balance change. The unique index on `(userId, idempotencyKey)` settles concurrent duplicates: the loser rolls back and returns the winner's transaction.

New money endpoints use `runIdempotent()` from `src/services/idempotency.ts`.

Errors use one format:

```json
{ "error": { "code": "EMAIL_TAKEN", "message": "Email is already registered" } }
```

```bash
curl -X POST localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Bob","email":"bob@example.com","password":"password123"}'

curl -X POST localhost:3000/api/wallet/deposit \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: deposit-001' \
  -d '{"amount":500}'
```

## Project structure

```
src/
  config/        Prisma client singleton
  constants/     Shared constants (HTTP status codes)
  controllers/   HTTP request/response handling
  middleware/    auth, validation, rate limiting, error handling
  repositories/  All database access (including transactions)
  routes/        Route definitions
  services/      Business logic
  validators/    zod schemas
prisma/          Schema and migrations
tests/           Jest + Supertest
```

## Database

Tables: `User`, `Wallet` (one per user), `Transaction`. Amounts are stored as integers in the smallest unit (poisha). A `CHECK (balance >= 0)` constraint on `Wallet` rejects negative balances at the database level.
