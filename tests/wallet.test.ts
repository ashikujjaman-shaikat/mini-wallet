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

const withdraw = (amount: unknown, key?: string) => {
  const req = request(app).post('/api/wallet/withdraw').set('Authorization', `Bearer ${token}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send({ amount });
};

const setBalance = (balance: number) =>
  prisma.wallet.update({ where: { userId }, data: { balance } });

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

describe('POST /api/wallet/withdraw', () => {
  beforeEach(async () => {
    await setBalance(1000);
  });

  it('reduces the balance and returns the transaction', async () => {
    const res = await withdraw(300, 'key-1');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'WITHDRAW', amount: 300, userId, toWalletId: null });
    expect(res.body.fromWalletId).toEqual(expect.any(Number));
    expect(await balance()).toBe(700);
  });

  it('allows withdrawing the exact balance', async () => {
    const res = await withdraw(1000, 'key-1');

    expect(res.status).toBe(201);
    expect(await balance()).toBe(0);
  });

  it('returns 400 for insufficient balance and leaves everything unchanged', async () => {
    const res = await withdraw(1001, 'key-1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balance()).toBe(1000);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('withdraws only once for the same Idempotency-Key', async () => {
    const first = await withdraw(300, 'key-1');
    const second = await withdraw(300, 'key-1');

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balance()).toBe(700);
  });

  it('returns 400 when the Idempotency-Key is missing', async () => {
    const res = await withdraw(300);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect(await balance()).toBe(1000);
  });

  it('never overdraws with parallel withdrawals using different keys', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => withdraw(300, `race-${i}`)),
    );

    const succeeded = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 400);
    expect(succeeded).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    for (const res of rejected) expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balance()).toBe(100);
    expect(await prisma.transaction.count()).toBe(3);
  });
});

describe('POST /api/wallet/transfer', () => {
  const bob = { name: 'Bob', email: 'bob@example.com', password: 'password123' };
  let bobToken: string;
  let aliceWalletId: number;
  let bobWalletId: number;

  const transfer = (from: string, toWalletId: unknown, amount: unknown, key?: string) => {
    const req = request(app).post('/api/wallet/transfer').set('Authorization', `Bearer ${from}`);
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send({ toWalletId, amount });
  };

  const balances = async () => {
    const [alice, b] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: aliceWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: bobWalletId } }),
    ]);
    return { alice: alice.balance, bob: b.balance };
  };

  beforeEach(async () => {
    const res = await request(app).post('/api/auth/register').send(bob);
    bobToken = res.body.token;

    aliceWalletId = (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).id;
    bobWalletId = (await prisma.wallet.findUniqueOrThrow({ where: { userId: res.body.user.id } }))
      .id;
    await prisma.wallet.update({ where: { id: aliceWalletId }, data: { balance: 1000 } });
    await prisma.wallet.update({ where: { id: bobWalletId }, data: { balance: 500 } });
  });

  it('moves money between wallets and conserves the total', async () => {
    const res = await transfer(token, bobWalletId, 300, 'key-1');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'TRANSFER',
      amount: 300,
      userId,
      fromWalletId: aliceWalletId,
      toWalletId: bobWalletId,
    });
    expect(await balances()).toEqual({ alice: 700, bob: 800 });
  });

  it('returns 400 for insufficient balance and changes neither wallet', async () => {
    const res = await transfer(token, bobWalletId, 1001, 'key-1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balances()).toEqual({ alice: 1000, bob: 500 });
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('returns 404 for an unknown receiver and rolls the debit back', async () => {
    const res = await transfer(token, 999_999_999, 300, 'key-1');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RECEIVER_NOT_FOUND');
    expect(await balances()).toEqual({ alice: 1000, bob: 500 });
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('rejects a transfer to the same wallet', async () => {
    const res = await transfer(token, aliceWalletId, 300, 'key-1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAME_WALLET');
    expect(await balances()).toEqual({ alice: 1000, bob: 500 });
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('moves money only once for the same Idempotency-Key', async () => {
    const first = await transfer(token, bobWalletId, 300, 'key-1');
    const second = await transfer(token, bobWalletId, 300, 'key-1');

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balances()).toEqual({ alice: 700, bob: 800 });
  });

  it('returns 400 when the Idempotency-Key is missing', async () => {
    const res = await transfer(token, bobWalletId, 300);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect(await balances()).toEqual({ alice: 1000, bob: 500 });
  });

  it.each([
    ['zero amount', { toWalletId: 1, amount: 0 }],
    ['decimal amount', { toWalletId: 1, amount: 1.5 }],
    ['string toWalletId', { toWalletId: '1', amount: 10 }],
    ['missing toWalletId', { amount: 10 }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-1')
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('completes parallel opposite transfers without deadlock errors and conserves money', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => transfer(token, bobWalletId, 10, `a-to-b-${i}`)),
      ...Array.from({ length: 10 }, (_, i) => transfer(bobToken, aliceWalletId, 10, `b-to-a-${i}`)),
    ]);

    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(await prisma.transaction.count()).toBe(20);
    expect(await balances()).toEqual({ alice: 1000, bob: 500 });
  });
});

describe('GET /api/wallet/transactions', () => {
  const bob = { name: 'Bob', email: 'bob@example.com', password: 'password123' };
  const carol = { name: 'Carol', email: 'carol@example.com', password: 'password123' };
  let bobToken: string;
  let aliceWalletId: number;
  let bobWalletId: number;
  let bobUserId: number;
  let carolToken: string;
  let carolWalletId: number;

  const list = (auth: string, query = '') =>
    request(app).get(`/api/wallet/transactions${query}`).set('Authorization', `Bearer ${auth}`);

  const post = (auth: string, path: string, body: object, key: string) =>
    request(app)
      .post(`/api/wallet/${path}`)
      .set('Authorization', `Bearer ${auth}`)
      .set('Idempotency-Key', key)
      .send(body);

  const register = async (account: typeof bob) => {
    const res = await request(app).post('/api/auth/register').send(account);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: res.body.user.id } });
    return {
      token: res.body.token as string,
      walletId: wallet.id,
      userId: res.body.user.id as number,
    };
  };

  beforeEach(async () => {
    aliceWalletId = (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).id;
    ({ token: bobToken, walletId: bobWalletId, userId: bobUserId } = await register(bob));
    ({ token: carolToken, walletId: carolWalletId } = await register(carol));
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/wallet/transactions');
    expect(res.status).toBe(401);
  });

  it('returns an empty page for a wallet with no transactions', async () => {
    const res = await list(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: 1, limit: 20, total: 0 });
  });

  describe('pagination and ordering', () => {
    beforeEach(async () => {
      // amount i + 1 with createdAt increasing in i, so amount 25 is the newest
      const base = Date.parse('2026-01-01T00:00:00Z');
      await prisma.transaction.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          type: 'DEPOSIT' as const,
          amount: i + 1,
          userId,
          toWalletId: aliceWalletId,
          idempotencyKey: `seed-${i}`,
          requestHash: 'x',
          createdAt: new Date(base + i * 1000),
        })),
      });
      await prisma.transaction.create({
        data: {
          type: 'DEPOSIT',
          amount: 999,
          userId: bobUserId,
          toWalletId: bobWalletId,
          idempotencyKey: 'bob-seed',
          requestHash: 'x',
        },
      });
    });

    it('uses page 1 and limit 20 by default and reports the total', async () => {
      const res = await list(token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 25 });
      expect(res.body.data).toHaveLength(20);
    });

    it('returns the right slices', async () => {
      const page1 = await list(token, '?page=1&limit=10');
      const page3 = await list(token, '?page=3&limit=10');
      const page4 = await list(token, '?page=4&limit=10');

      expect(page1.body).toMatchObject({ page: 1, limit: 10, total: 25 });
      expect(page1.body.data.map((t: { amount: number }) => t.amount)).toEqual([
        25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
      ]);
      expect(page3.body.data.map((t: { amount: number }) => t.amount)).toEqual([5, 4, 3, 2, 1]);
      expect(page3.body.total).toBe(25);
      expect(page4.body.data).toEqual([]);
    });

    it.each([
      ['page=0', '?page=0'],
      ['page=-1', '?page=-1'],
      ['limit=0', '?limit=0'],
      ['limit=101', '?limit=101'],
      ['limit=abc', '?limit=abc'],
      ['page=1.5', '?page=1.5'],
    ])('returns 400 for %s', async (_label, query) => {
      const res = await list(token, query);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts the maximum limit', async () => {
      const res = await list(token, '?limit=100');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(25);
    });
  });

  it('orders newest first and sets direction for deposit, withdraw and both transfer sides', async () => {
    await post(token, 'deposit', { amount: 1000 }, 'k1');
    await post(token, 'withdraw', { amount: 200 }, 'k2');
    await post(token, 'transfer', { toWalletId: bobWalletId, amount: 300 }, 'k3');

    const alice = await list(token);
    expect(alice.body.total).toBe(3);
    expect(
      alice.body.data.map((t: { type: string; direction: string }) => [t.type, t.direction]),
    ).toEqual([
      ['TRANSFER', 'OUT'],
      ['WITHDRAW', 'OUT'],
      ['DEPOSIT', 'IN'],
    ]);

    const bobList = await list(bobToken);
    expect(bobList.body.total).toBe(1);
    expect(bobList.body.data[0]).toMatchObject({
      type: 'TRANSFER',
      direction: 'IN',
      fromWalletId: aliceWalletId,
      toWalletId: bobWalletId,
    });
  });

  it('does not expose internal idempotency fields', async () => {
    await post(token, 'deposit', { amount: 100 }, 'secret-key');
    const res = await list(token);

    expect(res.body.data[0].requestHash).toBeUndefined();
    expect(res.body.data[0].idempotencyKey).toBeUndefined();
  });

  it("never shows a user another user's transactions", async () => {
    await post(token, 'deposit', { amount: 1000 }, 'k1');
    await post(token, 'withdraw', { amount: 100 }, 'k2');
    await post(token, 'transfer', { toWalletId: carolWalletId, amount: 300 }, 'k3');

    const bobList = await list(bobToken);
    expect(bobList.body).toEqual({ data: [], page: 1, limit: 20, total: 0 });

    const carolList = await list(carolToken);
    expect(carolList.body.total).toBe(1);
    expect(carolList.body.data[0]).toMatchObject({ direction: 'IN', toWalletId: carolWalletId });

    const aliceList = await list(token);
    expect(aliceList.body.total).toBe(3);
  });
});
