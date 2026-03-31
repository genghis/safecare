import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Mocks -- must be declared before importing the module under test
// ---------------------------------------------------------------------------

// In-memory Redis store
const redisStore: Record<string, { value: string; ttl?: number }> = {};

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      redisStore[key] = { value, ttl };
      return 'OK';
    }),
    get: vi.fn(async (key: string) => {
      return redisStore[key]?.value ?? null;
    }),
    del: vi.fn(async (key: string) => {
      delete redisStore[key];
      return 1;
    }),
  }));
  return { default: RedisMock };
});

// Track DB operations
let dbInsertValues: any[] = [];
let dbUpdateSets: any[] = [];
let dbSelectResults: any[] = [];

const mockReturning = vi.fn(() => dbInsertValues);
const mockInsertValues = vi.fn((vals: any) => {
  dbInsertValues.push(vals);
  return { returning: mockReturning };
});
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockUpdateReturning = vi.fn(() => dbUpdateSets);
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
const mockUpdateSet = vi.fn((vals: any) => {
  dbUpdateSets.push(vals);
  return { where: mockUpdateWhere };
});
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

const mockSelectWhere = vi.fn(() => dbSelectResults);
const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
  leftJoin: vi.fn(() => ({ where: mockSelectWhere })),
}));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

vi.mock('../db/index.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret',
    DEK: 'test-dek',
    HMAC_KEY: 'test-hmac-key',
  },
}));

// Import the service under test AFTER mocks are set up
import { DispatchService } from '../services/dispatch.service.js';

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

describe('DispatchService -- Session Key Management', () => {
  let dispatchService: DispatchService;

  beforeEach(() => {
    dispatchService = new DispatchService();
    vi.clearAllMocks();
    dbInsertValues = [];
    dbUpdateSets = [];
    dbSelectResults = [];
    clearRedisStore();
  });

  // -----------------------------------------------------------------------
  // getSessionKey
  // -----------------------------------------------------------------------

  describe('getSessionKey', () => {
    it('returns the session key stored in Redis', async () => {
      const driverId = 'driver-A';
      const sessionId = 'session-1';
      const expectedKey = 'abcdef1234567890';

      // Pre-populate Redis with a session key
      redisStore[`session_key:${driverId}:${sessionId}`] = {
        value: expectedKey,
        ttl: 28800,
      };

      const result = await dispatchService.getSessionKey(driverId, sessionId);
      expect(result).toBe(expectedKey);
    });

    it('returns null when no session key exists in Redis', async () => {
      const result = await dispatchService.getSessionKey(
        'driver-X',
        'session-nonexistent',
      );
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // revokeDriverSession
  // -----------------------------------------------------------------------

  describe('revokeDriverSession', () => {
    it('deletes the session key and sets a revoked flag with 24h TTL', async () => {
      const driverId = 'driver-A';
      const sessionId = 'session-1';

      // Pre-populate Redis with an existing session key
      redisStore[`session_key:${driverId}:${sessionId}`] = {
        value: 'some-session-key',
        ttl: 28800,
      };

      await dispatchService.revokeDriverSession(driverId, sessionId);

      // Session key should be deleted
      expect(redisStore[`session_key:${driverId}:${sessionId}`]).toBeUndefined();

      // Revoked flag should be set
      const revokedEntry = redisStore[`revoked:${driverId}:${sessionId}`];
      expect(revokedEntry).toBeDefined();
      expect(revokedEntry.value).toBe('1');
      expect(revokedEntry.ttl).toBe(86400); // 24 hours in seconds
    });
  });

  // -----------------------------------------------------------------------
  // isSessionRevoked
  // -----------------------------------------------------------------------

  describe('isSessionRevoked', () => {
    it('returns true when the session has been revoked', async () => {
      const driverId = 'driver-A';
      const sessionId = 'session-1';

      // Set the revoked flag directly
      redisStore[`revoked:${driverId}:${sessionId}`] = {
        value: '1',
        ttl: 86400,
      };

      const result = await dispatchService.isSessionRevoked(driverId, sessionId);
      expect(result).toBe(true);
    });

    it('returns false when the session has not been revoked', async () => {
      const result = await dispatchService.isSessionRevoked(
        'driver-B',
        'session-2',
      );
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // downloadRoute -- session key generation
  // -----------------------------------------------------------------------

  describe('downloadRoute — sessionKey in RoutePacket', () => {
    it('includes a sessionKey in the returned packet and stores it in Redis', async () => {
      const rawToken = 'download-token-for-session-key-test';
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      const driverId = 'driver-C';
      const sessionId = 'session-3';
      const routeDataTtlHours = 8;

      let selectCallIndex = 0;
      mockSelectFrom.mockImplementation(() => {
        selectCallIndex++;
        if (selectCallIndex === 1) {
          // downloadTokens lookup
          return {
            where: vi.fn(() => [
              {
                id: 'tok-sk-1',
                driverId,
                dispatchSessionId: sessionId,
                tokenHash,
                used: false,
                expiresAt: new Date(Date.now() + 600_000),
              },
            ]),
            leftJoin: vi.fn(() => ({ where: vi.fn(() => []) })),
          };
        }
        if (selectCallIndex === 2) {
          // deliveries + recipients join
          return {
            where: vi.fn(() => []),
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => [
                {
                  deliveryId: 'del-sk-1',
                  address: '100 Test Ave',
                  lat: '34.0522',
                  lng: '-118.2437',
                  notes: 'Leave at door',
                  recipientName: 'Alice',
                },
              ]),
            })),
          };
        }
        // session lookup for TTL
        return {
          where: vi.fn(() => [{ id: sessionId, routeDataTtlHours }]),
          leftJoin: vi.fn(() => ({ where: vi.fn(() => []) })),
        };
      });

      mockUpdateSet.mockReturnValue({
        where: vi.fn(() => ({ returning: vi.fn(() => [{}]) })),
      });

      const packet = await dispatchService.downloadRoute(rawToken);

      // Packet should include a sessionKey
      expect(packet).not.toBeNull();
      expect(packet!.sessionKey).toBeDefined();
      expect(typeof packet!.sessionKey).toBe('string');
      expect(packet!.sessionKey!.length).toBeGreaterThan(0);

      // Verify the session key was stored in Redis with the correct key pattern
      const redisKey = `session_key:${driverId}:${sessionId}`;
      expect(redisStore[redisKey]).toBeDefined();
      expect(redisStore[redisKey].value).toBe(packet!.sessionKey);
      expect(redisStore[redisKey].ttl).toBe(routeDataTtlHours * 3600);
    });
  });

  // -----------------------------------------------------------------------
  // confirmPurge -- session key deletion
  // -----------------------------------------------------------------------

  describe('confirmPurge — deletes session key from Redis', () => {
    it('deletes the session key from Redis before recording the purge', async () => {
      const driverId = 'driver-D';
      const sessionId = 'session-4';

      // Pre-populate Redis with a session key
      redisStore[`session_key:${driverId}:${sessionId}`] = {
        value: 'session-key-to-be-purged',
        ttl: 28800,
      };

      // Mock the update chain (driverCheckIns update)
      mockUpdateWhere.mockReturnValue({
        returning: vi.fn(() => [
          {
            id: 'checkin-purge',
            driverId,
            dispatchSessionId: sessionId,
            purgeConfirmedAt: new Date(),
          },
        ]),
      });

      // Mock the select chain (deliveries query for audit)
      mockSelectFrom.mockImplementation(() => ({
        where: vi.fn(() => [
          {
            id: 'del-purge-1',
            driverId,
            dispatchSessionId: sessionId,
            status: 'delivered',
            releasedAt: new Date('2026-03-30T09:00:00Z'),
          },
        ]),
        leftJoin: vi.fn(() => ({ where: vi.fn(() => []) })),
      }));

      // Mock insert for audit log
      mockInsertValues.mockReturnValue({
        returning: vi.fn(() => [{ id: 'audit-purge-1' }]),
      });

      await dispatchService.confirmPurge(driverId, sessionId);

      // The session key should have been deleted from Redis
      expect(
        redisStore[`session_key:${driverId}:${sessionId}`],
      ).toBeUndefined();
    });
  });
});
