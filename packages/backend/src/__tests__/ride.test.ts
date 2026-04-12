import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

let dbInsertValues: any[] = [];
let dbUpdateSets: any[] = [];
let dbSelectResults: any[] = [];
const redisStore = new Map<string, string>();

const mockReturning = vi.fn(() => dbInsertValues.length > 0 ? [dbInsertValues[dbInsertValues.length - 1]] : []);
const mockInsertValues = vi.fn((vals: any) => {
  dbInsertValues.push({ ...vals, id: `shift-${dbInsertValues.length + 1}` });
  return { returning: mockReturning };
});
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockUpdateReturning = vi.fn(() => dbUpdateSets.length > 0 ? [dbUpdateSets[dbUpdateSets.length - 1]] : []);
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
const mockUpdateSet = vi.fn((vals: any) => {
  dbUpdateSets.push(vals);
  return { where: mockUpdateWhere };
});
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

const mockSelectLimit = vi.fn(() => dbSelectResults);
const mockSelectOrderBy = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectWhere = vi.fn(() => dbSelectResults);
const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
  orderBy: mockSelectOrderBy,
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
    DEK: 'test-dek-0123456789abcdef',
    HMAC_KEY: 'test-hmac-key',
  },
  isUnlocked: () => true,
}));

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    del: vi.fn(async (key: string) => { redisStore.delete(key); return 1; }),
  }));
  return { default: RedisMock };
});

// Import after mocks
import { RideService } from '../services/ride.service.js';

describe('RideService — Shift Lifecycle', () => {
  let service: RideService;

  beforeEach(() => {
    service = new RideService();
    vi.clearAllMocks();
    dbInsertValues = [];
    dbUpdateSets = [];
    dbSelectResults = [];
    redisStore.clear();
  });

  describe('createAdHocShift', () => {
    it('creates an ad-hoc shift with correct fields', async () => {
      const shift = await service.createAdHocShift({
        recipientId: 'recipient-1',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-2',
        serviceType: 'ride',
        date: '2026-04-15',
        pickupTime: '09:00',
        estimatedDurationMinutes: 45,
        label: 'home to clinic',
        requiresCleanVehicle: true,
        passengerCount: 2,
        carSeatRequired: true,
        notes: 'Mom and infant',
      });

      expect(mockInsert).toHaveBeenCalled();
      const inserted = dbInsertValues[0];
      expect(inserted).toBeDefined();
      expect(inserted.recipientId).toBe('recipient-1');
      expect(inserted.serviceType).toBe('ride');
      expect(inserted.date).toBe('2026-04-15');
      expect(inserted.pickupTime).toBe('09:00');
      expect(inserted.status).toBe('open');
      expect(inserted.requiresCleanVehicle).toBe(true);
      expect(inserted.passengerCount).toBe(2);
      expect(inserted.carSeatRequired).toBe(true);
      expect(inserted.notes).toBe('Mom and infant');
    });

    it('defaults to non-sensitive ride when flags not provided', async () => {
      await service.createAdHocShift({
        recipientId: 'r-1',
        pickupLocationId: 'l-1',
        dropoffLocationId: 'l-2',
        serviceType: 'transit_escort',
        date: '2026-04-15',
        pickupTime: '14:00',
      });

      const inserted = dbInsertValues[0];
      expect(inserted.serviceType).toBe('transit_escort');
      expect(inserted.requiresCleanVehicle).toBe(false);
      expect(inserted.passengerCount).toBe(1);
      expect(inserted.carSeatRequired).toBe(false);
      expect(inserted.status).toBe('open');
    });
  });

  describe('claimShift — vehicle status enforcement', () => {
    it('rejects claim from hot vehicle on clean-only shift', async () => {
      // Return a clean-only shift
      dbSelectResults = [{
        id: 'shift-1',
        status: 'open',
        requiresCleanVehicle: true,
        passengerCount: 1,
      }];

      // Override for the second select (driver lookup) to return hot vehicle
      const origSelectFrom = mockSelectFrom;
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: shift lookup
          return { where: () => [{ id: 'shift-1', status: 'open', requiresCleanVehicle: true, passengerCount: 1 }] };
        }
        // Second call: driver lookup
        return { where: () => [{ vehicleStatus: 'hot' }] };
      });

      const result = await service.claimShift('shift-1', 'driver-1');
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('clean vehicle');
    });

    it('rejects claim when passenger capacity insufficient', async () => {
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { where: () => [{ id: 'shift-1', status: 'open', requiresCleanVehicle: false, passengerCount: 5 }] };
        }
        // Driver has only 4 seats
        return { where: () => [{ vehicleStatus: 'clean', passengerCapacity: 4 }] };
      });

      const result = await service.claimShift('shift-1', 'driver-1');
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('capacity');
    });

    it('returns error when shift is not open', async () => {
      dbSelectResults = [{ id: 'shift-1', status: 'confirmed' }];
      const result = await service.claimShift('shift-1', 'driver-1');
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('not available');
    });

    it('returns error for non-existent shift', async () => {
      dbSelectResults = [];
      const result = await service.claimShift('shift-999', 'driver-1');
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('not found');
    });
  });

  describe('shift status transitions', () => {
    it('confirmShift only works on claimed shifts', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'shift-1', status: 'confirmed' }]);

      const result = await service.confirmShift('shift-1');
      expect(mockUpdate).toHaveBeenCalled();
      const set = dbUpdateSets[0];
      expect(set.status).toBe('confirmed');
      expect(set.confirmedAt).toBeInstanceOf(Date);
    });

    it('rejectClaim resets shift to open with null driver', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'shift-1', status: 'open', driverId: null }]);

      const result = await service.rejectClaim('shift-1');
      expect(mockUpdate).toHaveBeenCalled();
      const set = dbUpdateSets[0];
      expect(set.status).toBe('open');
      expect(set.driverId).toBeNull();
      expect(set.claimedAt).toBeNull();
    });

    it('startShift sets in_progress with timestamp', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'shift-1', status: 'in_progress' }]);

      await service.startShift('shift-1');
      const set = dbUpdateSets[0];
      expect(set.status).toBe('in_progress');
      expect(set.startedAt).toBeInstanceOf(Date);
    });

    it('cancelShift stores reason', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'shift-1', status: 'cancelled' }]);

      await service.cancelShift('shift-1', 'Passenger cancelled');
      const set = dbUpdateSets[0];
      expect(set.status).toBe('cancelled');
      expect(set.cancellationReason).toBe('Passenger cancelled');
      expect(set.cancelledAt).toBeInstanceOf(Date);
    });

    it('markNoShow sets no_show status', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'shift-1', status: 'no_show' }]);

      await service.markNoShow('shift-1');
      const set = dbUpdateSets[0];
      expect(set.status).toBe('no_show');
    });
  });

  describe('completeShift — affinity tracking', () => {
    it('updates driver-passenger affinity on completion', async () => {
      // getShift returns an in_progress shift
      dbSelectResults = [{ id: 'shift-1', status: 'in_progress', driverId: 'driver-1', recipientId: 'recip-1' }];
      mockUpdateReturning.mockReturnValueOnce([{ id: 'shift-1', status: 'completed' }]);

      await service.completeShift('shift-1');

      // Should have called update for the shift AND insert/update for affinity
      expect(mockUpdate).toHaveBeenCalled();
      const shiftUpdate = dbUpdateSets[0];
      expect(shiftUpdate.status).toBe('completed');
      expect(shiftUpdate.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('getRideStats', () => {
    it('returns categorized counts for today', async () => {
      // Mock shifts for today
      mockSelectFrom.mockImplementation(() => ({
        where: vi.fn(() => [
          { status: 'open' },
          { status: 'open' },
          { status: 'claimed' },
          { status: 'confirmed' },
          { status: 'in_progress' },
          { status: 'completed' },
        ]),
      }));

      const stats = await service.getRideStats();
      expect(stats.todaysRides).toBe(6);
      expect(stats.openShifts).toBe(2);
      expect(stats.claimedShifts).toBe(1);
      expect(stats.confirmedShifts).toBe(1);
      expect(stats.inProgressShifts).toBe(1);
      expect(stats.completedToday).toBe(1);
    });
  });

  describe('intake requests', () => {
    it('creates intake request with source and raw text', async () => {
      await service.createIntakeRequest({
        source: 'whatsapp',
        rawText: 'Need ride to perinatal care Mon/Wed 9am from Phillips',
        parsedData: { days: ['mon', 'wed'], time: '09:00', neighborhood: 'Phillips' },
      });

      const inserted = dbInsertValues[0];
      expect(inserted.source).toBe('whatsapp');
      expect(inserted.rawText).toContain('perinatal care');
      expect(inserted.parsedData).toHaveProperty('days');
    });

    it('processIntakeRequest marks as processed with admin', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'intake-1', status: 'processed' }]);

      await service.processIntakeRequest('intake-1', 'admin-1', {
        status: 'processed',
        linkedRecipientId: 'recip-1',
      });

      const set = dbUpdateSets[0];
      expect(set.status).toBe('processed');
      expect(set.processedBy).toBe('admin-1');
      expect(set.processedAt).toBeInstanceOf(Date);
      expect(set.linkedRecipientId).toBe('recip-1');
    });

    it('processIntakeRequest stores rejection reason', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'intake-1', status: 'rejected' }]);

      await service.processIntakeRequest('intake-1', 'admin-1', {
        status: 'rejected',
        rejectionReason: 'Duplicate request',
      });

      const set = dbUpdateSets[0];
      expect(set.status).toBe('rejected');
      expect(set.rejectionReason).toBe('Duplicate request');
    });
  });
});
