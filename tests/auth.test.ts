import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { authenticate } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/errorHandler';

const user = { name: 'Alice', email: 'alice@example.com', password: 'password123' };

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates a user and an empty wallet, and returns a token without passwordHash', async () => {
    const res = await request(app).post('/api/auth/register').send(user);

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    expect(res.body.user.passwordHash).toBeUndefined();

    const wallet = await prisma.wallet.findUnique({ where: { userId: res.body.user.id } });
    expect(wallet).not.toBeNull();
    expect(wallet?.balance).toBe(0);
  });

  it('returns 409 for a duplicate email', async () => {
    await request(app).post('/api/auth/register').send(user);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...user, name: 'Other' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await prisma.user.count()).toBe(1);
  });

  it('returns 400 for invalid input', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(user);
  });

  it('returns a token on success', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('returns 401 for a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same 401 message for an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });
});

describe('authenticate middleware', () => {
  const protectedApp = express();
  protectedApp.get('/protected', authenticate, (req, res) => {
    res.json({ userId: req.user?.id });
  });
  protectedApp.use(errorHandler);

  it('returns 401 without a token', async () => {
    const res = await request(protectedApp).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for an invalid token', async () => {
    const res = await request(protectedApp)
      .get('/protected')
      .set('Authorization', 'Bearer garbage');

    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign({}, process.env.JWT_SECRET as string, { subject: '1', expiresIn: -10 });
    const res = await request(protectedApp)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Token expired');
  });

  it('sets req.user from a valid token', async () => {
    const { body } = await request(app).post('/api/auth/register').send(user);
    const res = await request(protectedApp)
      .get('/protected')
      .set('Authorization', `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(body.user.id);
  });
});
