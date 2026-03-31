import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const redisStore: Record<string, { value: string; ttl?: number }> = {};

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      redisStore[key] = { value, ttl };
      return 'OK';
    }),
    get: vi.fn(async (key: string) => redisStore[key]?.value ?? null),
    del: vi.fn(async (key: string) => {
      delete redisStore[key];
      return 1;
    }),
    scan: vi.fn(async (_cursor: string, _match: string, pattern: string, _count: string, count: string) => {
      const keys = Object.keys(redisStore).filter(k => {
        const p = pattern.replace('*', '');
        return k.startsWith(p);
      });
      return ['0', keys];
    }),
  }));
  return { default: RedisMock };
});

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret',
    DEK: '',
    HMAC_KEY: 'test-hmac',
  },
  isUnlocked: vi.fn(() => true),
}));

import { registerSession, revokeSession, revokeAllSessions } from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearRedisStore() {
  for (const key of Object.keys(redisStore)) {
    delete redisStore[key];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin Session Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRedisStore();
  });

  describe('registerSession', () => {
    it('stores a session in Redis with the correct TTL', async () => {
      await registerSession('jti-abc', 'admin-1', 86400);

      const entry = redisStore['admin_session:jti-abc'];
      expect(entry).toBeDefined();
      expect(entry.value).toBe('admin-1');
      expect(entry.ttl).toBe(86400);
    });
  });

  describe('revokeSession', () => {
    it('removes a session from Redis', async () => {
      redisStore['admin_session:jti-xyz'] = { value: 'admin-1', ttl: 86400 };

      await revokeSession('jti-xyz');

      expect(redisStore['admin_session:jti-xyz']).toBeUndefined();
    });
  });

  describe('revokeAllSessions', () => {
    it('removes all sessions for a specific admin', async () => {
      redisStore['admin_session:jti-1'] = { value: 'admin-1', ttl: 86400 };
      redisStore['admin_session:jti-2'] = { value: 'admin-1', ttl: 86400 };
      redisStore['admin_session:jti-3'] = { value: 'admin-2', ttl: 86400 };

      const revoked = await revokeAllSessions('admin-1');

      expect(revoked).toBe(2);
      expect(redisStore['admin_session:jti-1']).toBeUndefined();
      expect(redisStore['admin_session:jti-2']).toBeUndefined();
      // admin-2's session should remain
      expect(redisStore['admin_session:jti-3']).toBeDefined();
    });

    it('returns 0 when no sessions exist for the admin', async () => {
      redisStore['admin_session:jti-other'] = { value: 'admin-other', ttl: 86400 };

      const revoked = await revokeAllSessions('admin-nonexistent');

      expect(revoked).toBe(0);
    });
  });
});
