import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';

const user = { name: 'Alice', email: 'alice@example.com', password: 'password123' };

let token: string;
let userId: number;

const deposit = (amount: unknown, key?: string) => {
  const req = request(app).post('/api/wallet/deposit').set('Authorization', `Bearer ${token}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send({ amount });
};

const balance = async (): Promise<number> =>
  (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();

  const res = await request(app).post('/api/auth/register').send(user);
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/wallet', () => {
  it('returns the logged-in user wallet', async () => {
    const res = await request(app).get('/api/wallet').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId, balance: 0, currency: 'BDT' });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/wallet');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/wallet/deposit', () => {
  it('increases the balance and returns the transaction', async () => {
    const res = await deposit(500, 'key-1');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'DEPOSIT', amount: 500, userId, fromWalletId: null });
    expect(res.body.toWalletId).toEqual(expect.any(Number));
    expect(res.body.requestHash).toBeUndefined();
    expect(await balance()).toBe(500);

    const wallet = await request(app).get('/api/wallet').set('Authorization', `Bearer ${token}`);
    expect(wallet.body.balance).toBe(500);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/wallet/deposit')
      .set('Idempotency-Key', 'k')
      .send({ amount: 5 });
    expect(res.status).toBe(401);
  });

  it('replays the same key: one transaction, identical response, one balance change', async () => {
    const first = await deposit(500, 'key-1');
    const second = await deposit(500, 'key-1');

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balance()).toBe(500);
  });

  it('treats the same key with a different amount as reuse (422)', async () => {
    await deposit(500, 'key-1');
    const res = await deposit(600, 'key-1');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balance()).toBe(500);
  });

  it('returns 400 when the Idempotency-Key is missing', async () => {
    const res = await deposit(500);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect(await balance()).toBe(0);
  });

  it.each([
    ['negative', -5],
    ['zero', 0],
    ['decimal', 1.5],
    ['string', '100'],
    ['above the maximum', 100_000_001],
  ])('returns 400 for a %s amount', async (_label, amount) => {
    const res = await deposit(amount, 'key-1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('handles 10 parallel requests with the same key as one deposit', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => deposit(500, 'race-key')));

    for (const res of results) {
      expect(res.status).toBe(201);
      expect(res.body).toEqual(results[0].body);
    }
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balance()).toBe(500);
  });
});
