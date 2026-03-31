import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

// Fake Redis store for OTP tests
const redisStore: Record<string, { value: string; ttl: number }> = {};

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

// Fake DB: capture calls and return configurable results
const {
  dbState,
  mockReturning,
  mockValues,
  mockInsert,
  mockWhere,
  mockLimit,
  mockFrom,
  mockSelect,
  mockUpdate,
  mockUpdateSet,
} = vi.hoisted(() => {
  const dbState = {
    insertReturnValue: [] as any[],
    selectReturnValue: [] as any[],
  };
  const mockReturning = vi.fn(() => dbState.insertReturnValue);
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockWhere = vi.fn(() => dbState.selectReturnValue);
  const mockLimit = vi.fn(() => dbState.selectReturnValue);
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  // Update mock chain
  const mockUpdateWhere = vi.fn(() => ({}));
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  return { dbState, mockReturning, mockValues, mockInsert, mockWhere, mockLimit, mockFrom, mockSelect, mockUpdate, mockUpdateSet };
});

vi.mock('../db/index.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  },
}));

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret-key-for-testing',
    DEK: 'test-data-encryption-key',
    HMAC_KEY: 'test-hmac-key-for-hashing',
  },
}));

// Import the service under test AFTER mocks are set up
import { AuthService } from '../services/auth.service.js';

describe('AuthService — Admin Authentication', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    vi.clearAllMocks();
    dbState.insertReturnValue = [];
    dbState.selectReturnValue = [];
    // Clear redis store
    for (const key of Object.keys(redisStore)) {
      delete redisStore[key];
    }
  });

  // -----------------------------------------------------------------------
  // Admin creation
  // -----------------------------------------------------------------------

  describe('createAdmin', () => {
    it('hashes the password with bcrypt — stored hash is NOT plaintext', async () => {
      const plainPassword = 'SuperSecret123!';

      dbState.insertReturnValue = [
        { id: 'admin-uuid-1', email: 'admin@test.com', role: 'admin' },
      ];

      await authService.createAdmin('admin@test.com', plainPassword);

      // Inspect the password hash that was passed to db.insert().values()
      const valuesArg = mockValues.mock.calls[0][0];
      const storedHash = valuesArg.passwordHash;

      expect(storedHash).not.toBe(plainPassword);
      expect(storedHash).toMatch(/^\$2[aby]?\$/); // bcrypt prefix
      // Verify the hash actually validates against the original password
      const matches = await bcrypt.compare(plainPassword, storedHash);
      expect(matches).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Admin login
  // -----------------------------------------------------------------------

  describe('loginAdmin', () => {
    const signJwt = vi.fn(
      (payload: object, _options: object) =>
        `jwt-token-${JSON.stringify(payload)}`,
    );

    it('rejects a wrong password and returns null', async () => {
      const correctHash = await bcrypt.hash('correctPassword', 12);
      dbState.selectReturnValue = [
        { id: 'admin-1', email: 'a@b.com', passwordHash: correctHash, role: 'admin' },
      ];

      const result = await authService.loginAdmin('a@b.com', 'wrongPassword', signJwt);
      expect(result).toBeNull();
      expect(signJwt).not.toHaveBeenCalled();
    });

    it('returns a JWT with sub and role:admin on valid credentials', async () => {
      const password = 'correctPassword';
      const correctHash = await bcrypt.hash(password, 12);
      dbState.selectReturnValue = [
        { id: 'admin-42', email: 'a@b.com', passwordHash: correctHash, role: 'admin' },
      ];

      const result = await authService.loginAdmin('a@b.com', password, signJwt);

      expect(result).not.toBeNull();
      expect(result!.token).toContain('admin-42');
      expect(signJwt).toHaveBeenCalledWith(
        { sub: 'admin-42', role: 'admin' },
        { expiresIn: '24h' },
      );
      expect(result!.admin).toEqual({
        id: 'admin-42',
        email: 'a@b.com',
        role: 'admin',
      });
    });

    it('rejects a non-existent email and returns null', async () => {
      dbState.selectReturnValue = []; // no rows

      const result = await authService.loginAdmin(
        'noone@test.com',
        'anything',
        signJwt,
      );
      expect(result).toBeNull();
      expect(signJwt).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Admin exists guard
  // -----------------------------------------------------------------------

  describe('adminExists', () => {
    it('returns true when an admin row exists', async () => {
      // The select().from().limit() chain — mockFrom returns object with both where and limit
      mockFrom.mockReturnValueOnce({
        where: mockWhere,
        limit: vi.fn(() => [{ id: 'admin-1' }]),
      });

      const exists = await authService.adminExists();
      expect(exists).toBe(true);
    });

    it('returns false when no admin rows exist (registration not blocked)', async () => {
      mockFrom.mockReturnValueOnce({
        where: mockWhere,
        limit: vi.fn(() => []),
      });

      const exists = await authService.adminExists();
      expect(exists).toBe(false);
    });
  });
});

describe('AuthService — Driver OTP Authentication', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    vi.clearAllMocks();
    dbState.insertReturnValue = [];
    dbState.selectReturnValue = [];
    for (const key of Object.keys(redisStore)) {
      delete redisStore[key];
    }
  });

  // -----------------------------------------------------------------------
  // OTP generation
  // -----------------------------------------------------------------------

  describe('driverRequestOTP', () => {
    it('returns a 6-digit numeric string', async () => {
      const otp = await authService.driverRequestOTP('+15551234567');
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('stores the OTP in Redis with 300-second TTL', async () => {
      await authService.driverRequestOTP('+15551234567');

      // Find the stored entry in our in-memory redis
      const keys = Object.keys(redisStore);
      expect(keys.length).toBe(1);
      expect(keys[0]).toMatch(/^otp:/);

      const entry = redisStore[keys[0]];
      expect(entry.ttl).toBe(300);
      expect(entry.value).toMatch(/^\d{6}$/);
    });
  });

  // -----------------------------------------------------------------------
  // OTP verification
  // -----------------------------------------------------------------------

  describe('driverVerifyOTP', () => {
    const signJwt = vi.fn(
      (payload: object, _options: object) =>
        `driver-jwt-${JSON.stringify(payload)}`,
    );

    it('succeeds with the correct OTP and returns a JWT with role:driver', async () => {
      // Generate OTP first so it is in Redis
      const otp = await authService.driverRequestOTP('+15551234567');

      // DB lookup should find the driver
      dbState.selectReturnValue = [{ id: 'driver-99' }];

      const result = await authService.driverVerifyOTP(
        '+15551234567',
        otp,
        signJwt,
      );

      expect(result).not.toBeNull();
      expect(result!.driverId).toBe('driver-99');
      expect(signJwt).toHaveBeenCalledWith(
        { sub: 'driver-99', role: 'driver' },
        { expiresIn: '24h' },
      );
      expect(result!.token).toContain('driver');
    });

    it('fails with a wrong OTP', async () => {
      await authService.driverRequestOTP('+15551234567');

      const result = await authService.driverVerifyOTP(
        '+15551234567',
        '000000',
        signJwt,
      );

      expect(result).toBeNull();
      expect(signJwt).not.toHaveBeenCalled();
    });

    it('fails with an expired OTP (deleted from Redis)', async () => {
      // Request OTP, then manually remove it from the store (simulating expiry)
      await authService.driverRequestOTP('+15551234567');
      for (const key of Object.keys(redisStore)) {
        delete redisStore[key];
      }

      const result = await authService.driverVerifyOTP(
        '+15551234567',
        '123456',
        signJwt,
      );

      expect(result).toBeNull();
    });

    it('deletes the OTP from Redis after successful verification (single-use)', async () => {
      const otp = await authService.driverRequestOTP('+15551234567');
      dbState.selectReturnValue = [{ id: 'driver-1' }];

      await authService.driverVerifyOTP('+15551234567', otp, signJwt);

      // Redis store should now be empty — OTP consumed
      const remainingKeys = Object.keys(redisStore);
      expect(remainingKeys.length).toBe(0);
    });

    it('second verification with same OTP fails (single-use enforcement)', async () => {
      const otp = await authService.driverRequestOTP('+15551234567');
      dbState.selectReturnValue = [{ id: 'driver-1' }];

      // First verification succeeds
      const first = await authService.driverVerifyOTP(
        '+15551234567',
        otp,
        signJwt,
      );
      expect(first).not.toBeNull();

      // Second attempt should fail because OTP was deleted
      const second = await authService.driverVerifyOTP(
        '+15551234567',
        otp,
        signJwt,
      );
      expect(second).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

describe('AuthService — TOTP Backup Codes', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    vi.clearAllMocks();
    dbState.insertReturnValue = [];
    dbState.selectReturnValue = [];
  });

  describe('enableTotp', () => {
    it('returns 8 backup codes on successful enable', async () => {
      // Generate a valid TOTP secret and token
      const { secret, uri } = authService.generateTotpSecret('test@example.com');
      const { TOTP, Secret } = await import('otpauth');
      const totp = new TOTP({
        issuer: 'SafeCare',
        label: 'test@example.com',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      });
      const validToken = totp.generate();

      const result = await authService.enableTotp('admin-1', secret, validToken);

      expect(result).not.toBeNull();
      expect(result!.backupCodes).toHaveLength(8);
      // Each code should be 8 hex chars
      for (const code of result!.backupCodes) {
        expect(code).toMatch(/^[0-9a-f]{8}$/);
      }
    });

    it('returns null on invalid TOTP token', async () => {
      const { secret } = authService.generateTotpSecret('test@example.com');
      const result = await authService.enableTotp('admin-1', secret, '000000');
      expect(result).toBeNull();
    });

    it('stores bcrypt-hashed backup codes in the database', async () => {
      const { secret } = authService.generateTotpSecret('test@example.com');
      const { TOTP, Secret } = await import('otpauth');
      const totp = new TOTP({
        issuer: 'SafeCare',
        label: '',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      });

      await authService.enableTotp('admin-1', secret, totp.generate());

      // Check that db.update was called with hashed backup codes
      expect(mockUpdateSet).toHaveBeenCalled();
      const setArg = mockUpdateSet.mock.calls[0][0];
      expect(setArg.totpSecret).toBe(secret);
      expect(setArg.totpBackupCodes).toHaveLength(8);
      // Hashes should be bcrypt format, not plaintext
      for (const hash of setArg.totpBackupCodes) {
        expect(hash).toMatch(/^\$2[aby]?\$/);
      }
    });
  });

  describe('verifyTotp with backup codes', () => {
    it('accepts a valid backup code and consumes it', async () => {
      const backupCode = 'abcd1234';
      const backupHash = await bcrypt.hash(backupCode, 12);

      // Mock the DB to return an admin with TOTP + backup codes
      dbState.selectReturnValue = [{
        totpSecret: 'JBSWY3DPEHPK3PXP', // dummy base32 secret
        totpBackupCodes: [backupHash],
      }];

      const result = await authService.verifyTotp('admin-1', backupCode);
      expect(result).toBe(true);

      // Verify the backup code was consumed (update called with empty array)
      expect(mockUpdateSet).toHaveBeenCalled();
      const setArg = mockUpdateSet.mock.calls[0][0];
      expect(setArg.totpBackupCodes).toHaveLength(0);
    });

    it('rejects an invalid backup code', async () => {
      const backupHash = await bcrypt.hash('realcode', 12);

      dbState.selectReturnValue = [{
        totpSecret: 'JBSWY3DPEHPK3PXP',
        totpBackupCodes: [backupHash],
      }];

      const result = await authService.verifyTotp('admin-1', 'wrongcode');
      expect(result).toBe(false);
    });

    it('rejects when no backup codes remain', async () => {
      dbState.selectReturnValue = [{
        totpSecret: 'JBSWY3DPEHPK3PXP',
        totpBackupCodes: [],
      }];

      const result = await authService.verifyTotp('admin-1', 'anything');
      expect(result).toBe(false);
    });
  });
});
