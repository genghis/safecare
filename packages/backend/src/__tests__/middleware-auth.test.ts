import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';

vi.mock('../config.js', () => ({
  config: {
    JWT_SECRET: 'test-jwt-secret',
    DEK: 'test-dek',
    HMAC_KEY: 'test-hmac-key',
    REDIS_URL: 'redis://localhost:6379',
  },
  isUnlocked: vi.fn(() => true),
}));

import authPlugin from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Test Fastify server with JWT + auth middleware
// ---------------------------------------------------------------------------

let app: FastifyInstance;
const JWT_SECRET = 'test-jwt-secret-for-middleware-tests';

beforeAll(async () => {
  app = Fastify();
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(authPlugin);

  // Admin-only route
  app.get(
    '/admin-only',
    { preHandler: [app.requireAdmin] },
    async () => ({ ok: true, route: 'admin' }),
  );

  // Driver-only route
  app.get(
    '/driver-only',
    { preHandler: [app.requireDriver] },
    async () => ({ ok: true, route: 'driver' }),
  );

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function signToken(payload: object, expiresIn = '1h'): string {
  return app.jwt.sign(payload, { expiresIn });
}

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe('requireAdmin middleware', () => {
  it('allows requests with a valid admin JWT', async () => {
    const token = signToken({ sub: 'admin-1', role: 'admin' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, route: 'admin' });
  });

  it('rejects requests with no JWT (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Unauthorized');
  });

  it('rejects requests with a driver JWT (403 — wrong role)', async () => {
    const token = signToken({ sub: 'driver-1', role: 'driver' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toContain('admin role required');
  });

  it('rejects requests with an expired JWT (401)', async () => {
    // Create a token that expires in 1ms, then wait for it to expire
    const token = signToken({ sub: 'admin-1', role: 'admin' }, '1ms');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a malformed JWT (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: 'Bearer not.a.valid.jwt.token' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// requireDriver
// ---------------------------------------------------------------------------

describe('requireDriver middleware', () => {
  it('allows requests with a valid driver JWT', async () => {
    const token = signToken({ sub: 'driver-1', role: 'driver' });

    const res = await app.inject({
      method: 'GET',
      url: '/driver-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, route: 'driver' });
  });

  it('rejects requests with no JWT (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/driver-only',
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with an admin JWT (403 — wrong role)', async () => {
    const token = signToken({ sub: 'admin-1', role: 'admin' });

    const res = await app.inject({
      method: 'GET',
      url: '/driver-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toContain('driver role required');
  });
});

// ---------------------------------------------------------------------------
// Role escalation — cross-role access attempts
// ---------------------------------------------------------------------------

describe('Role escalation prevention', () => {
  it('driver token cannot access admin routes', async () => {
    const token = signToken({ sub: 'driver-1', role: 'driver' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('admin token cannot access driver-only routes', async () => {
    const token = signToken({ sub: 'admin-1', role: 'admin' });

    const res = await app.inject({
      method: 'GET',
      url: '/driver-only',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
