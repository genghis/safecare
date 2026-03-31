import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let dbInsertValues: any[] = [];

const mockInsertValues = vi.fn((vals: any) => {
  dbInsertValues.push(vals);
  return { returning: vi.fn(() => []) };
});
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

vi.mock('../db/index.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
  },
}));

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret',
    DEK: '',
    HMAC_KEY: 'test-hmac-key',
  },
  isUnlocked: vi.fn(() => true),
}));

import { logAdminAction, logSystemAction } from '../services/audit.service.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audit Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbInsertValues = [];
  });

  describe('logAdminAction', () => {
    it('writes an audit entry with admin ID and IP', async () => {
      const fakeRequest = {
        user: { sub: 'admin-1', role: 'admin' },
        headers: {},
        ip: '192.168.1.10',
        log: { error: vi.fn() },
      } as any;

      await logAdminAction('admin_login', fakeRequest, { email: 'admin@test.com' });

      expect(mockInsert).toHaveBeenCalled();
      expect(dbInsertValues).toHaveLength(1);

      const entry = dbInsertValues[0];
      expect(entry.adminId).toBe('admin-1');
      expect(entry.action).toBe('admin_login');
      expect(entry.ip).toBe('192.168.1.10');
      expect(entry.details).toEqual({ email: 'admin@test.com' });
    });

    it('extracts IP from X-Forwarded-For header', async () => {
      const fakeRequest = {
        user: { sub: 'admin-2', role: 'admin' },
        headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1' },
        ip: '127.0.0.1',
        log: { error: vi.fn() },
      } as any;

      await logAdminAction('admin_logout', fakeRequest);

      const entry = dbInsertValues[0];
      expect(entry.ip).toBe('10.0.0.1');
    });

    it('handles missing user gracefully', async () => {
      const fakeRequest = {
        user: undefined,
        headers: {},
        ip: '127.0.0.1',
        log: { error: vi.fn() },
      } as any;

      await logAdminAction('admin_login_failed', fakeRequest, { email: 'bad@test.com' });

      const entry = dbInsertValues[0];
      expect(entry.adminId).toBeNull();
      expect(entry.action).toBe('admin_login_failed');
    });

    it('does not throw on DB error', async () => {
      mockInsert.mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const fakeRequest = {
        user: { sub: 'admin-1' },
        headers: {},
        ip: '127.0.0.1',
        log: { error: vi.fn() },
      } as any;

      // Should not throw
      await expect(logAdminAction('admin_login', fakeRequest)).resolves.toBeUndefined();
    });
  });

  describe('logSystemAction', () => {
    it('writes a system audit entry without request context', async () => {
      await logSystemAction('hourly_purge', { driverId: 'driver-1', stopCount: 5, completedCount: 4 });

      expect(dbInsertValues).toHaveLength(1);
      const entry = dbInsertValues[0];
      expect(entry.action).toBe('hourly_purge');
      expect(entry.driverId).toBe('driver-1');
      expect(entry.stopCount).toBe(5);
      expect(entry.completedCount).toBe(4);
    });
  });
});
