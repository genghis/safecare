import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let dbInsertValues: any[] = [];
let dbUpdateSets: any[] = [];
let dbSelectResults: any[] = [];
let dbDeleteCalls: string[] = [];

const mockReturning = vi.fn(() =>
  dbInsertValues.length > 0 ? [dbInsertValues[dbInsertValues.length - 1]] : []
);
const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
const mockInsertValues = vi.fn((vals: any) => {
  dbInsertValues.push({ ...vals, id: `prov-${dbInsertValues.length + 1}` });
  return { returning: mockReturning, onConflictDoUpdate: mockOnConflict };
});
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockUpdateReturning = vi.fn(() =>
  dbUpdateSets.length > 0 ? [dbUpdateSets[dbUpdateSets.length - 1]] : []
);
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
const mockUpdateSet = vi.fn((vals: any) => {
  dbUpdateSets.push(vals);
  return { where: mockUpdateWhere };
});
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

const mockGroupBy = vi.fn(() => []);
const mockSelectWhere = vi.fn(() => dbSelectResults);
const mockSelectOrderBy = vi.fn(() => dbSelectResults);
const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
  orderBy: mockSelectOrderBy,
  leftJoin: vi.fn(() => ({
    where: mockSelectWhere,
    orderBy: mockSelectOrderBy,
  })),
  groupBy: mockGroupBy,
}));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockDeleteWhere = vi.fn(() => Promise.resolve());
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

vi.mock('../db/index.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDelete(...args),
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
    setex: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    del: vi.fn(async () => 1),
  }));
  return { default: RedisMock };
});

// Import after mocks
import { ReferralService } from '../services/referral.service.js';

describe('ReferralService — Vetted Referral Network', () => {
  let service: ReferralService;

  beforeEach(() => {
    service = new ReferralService();
    vi.clearAllMocks();
    dbInsertValues = [];
    dbUpdateSets = [];
    dbSelectResults = [];
    dbDeleteCalls = [];
  });

  describe('createProvider', () => {
    it('creates provider with encrypted PII fields', async () => {
      await service.createProvider('admin-1', {
        category: 'veterinary',
        name: 'Dr. Sarah Pet Vet',
        businessName: 'Phillips Animal Clinic',
        phone: '+16125551234',
        email: 'sarah@phillipsvet.com',
        address: '123 Main St, Minneapolis',
        neighborhoods: ['Phillips', 'Powderhorn'],
        languages: ['en', 'es'],
        lowBono: true,
        slidingScale: true,
        specialties: ['small animals', 'emergency'],
      });

      expect(mockInsert).toHaveBeenCalled();
      const inserted = dbInsertValues[0];

      // PII fields should use SQL expressions (not plaintext)
      // In the mock, they'll be the sql template objects
      expect(inserted.category).toBe('veterinary');
      expect(inserted.neighborhoods).toEqual(['Phillips', 'Powderhorn']);
      expect(inserted.languages).toEqual(['en', 'es']);
      expect(inserted.lowBono).toBe(true);
      expect(inserted.slidingScale).toBe(true);
      expect(inserted.specialties).toEqual(['small animals', 'emergency']);
      expect(inserted.status).toBe('under_review');
      expect(inserted.createdBy).toBe('admin-1');
    });

    it('auto-vouches the creator after adding provider', async () => {
      // The createProvider method calls addVouch after creation
      // First insert is the provider, second should be the vouch
      await service.createProvider('admin-1', {
        category: 'legal',
        name: 'Jane Attorney',
      });

      // Should have at least 2 insert calls (provider + vouch)
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });

    it('sets initial status to under_review', async () => {
      await service.createProvider('admin-1', {
        category: 'automotive',
        name: 'Bob Mechanic',
      });

      const inserted = dbInsertValues[0];
      expect(inserted.status).toBe('under_review');
    });
  });

  describe('updateProvider', () => {
    it('updates non-PII fields directly', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'prov-1' }]);

      await service.updateProvider('prov-1', {
        category: 'dental',
        neighborhoods: ['Seward'],
        lowBono: false,
        status: 'active',
      });

      expect(mockUpdate).toHaveBeenCalled();
      const set = dbUpdateSets[0];
      expect(set.category).toBe('dental');
      expect(set.neighborhoods).toEqual(['Seward']);
      expect(set.lowBono).toBe(false);
      expect(set.status).toBe('active');
      expect(set.updatedAt).toBeInstanceOf(Date);
    });

    it('encrypts PII fields when updated', async () => {
      mockUpdateReturning.mockReturnValueOnce([{ id: 'prov-1' }]);

      await service.updateProvider('prov-1', {
        name: 'Updated Name',
        phone: '+16125559999',
      });

      const set = dbUpdateSets[0];
      // nameEnc and phoneEnc should be SQL expressions (encrypted)
      expect(set).toHaveProperty('nameEnc');
      expect(set).toHaveProperty('nameHash');
      expect(set).toHaveProperty('phoneEnc');
      expect(set).toHaveProperty('phoneHash');
    });
  });

  describe('vouch system', () => {
    it('adds a vouch with trust level', async () => {
      await service.addVouch('prov-1', 'admin-1', 'personally_used', 'Great service');

      expect(mockInsert).toHaveBeenCalled();
      const inserted = dbInsertValues[0];
      expect(inserted.providerId).toBe('prov-1');
      expect(inserted.adminId).toBe('admin-1');
      expect(inserted.level).toBe('personally_used');
      expect(inserted.notes).toBe('Great service');
    });

    it('defaults vouch level to community_known', async () => {
      await service.addVouch('prov-1', 'admin-2');

      const inserted = dbInsertValues[0];
      expect(inserted.level).toBe('community_known');
    });

    it('auto-activates provider at 2+ vouches', async () => {
      // Mock getVouches to return 2 vouches
      dbSelectResults = [
        { id: 'v1', providerId: 'prov-1', adminId: 'admin-1' },
        { id: 'v2', providerId: 'prov-1', adminId: 'admin-2' },
      ];

      await service.addVouch('prov-1', 'admin-2', 'trusted_referral');

      // Should have called update to set status to 'active'
      expect(mockUpdate).toHaveBeenCalled();
      const updateCalls = dbUpdateSets.filter(s => s.status === 'active');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('removes a vouch', async () => {
      await service.removeVouch('prov-1', 'admin-1');
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('searches by category and logs the lookup', async () => {
      dbSelectResults = [
        {
          id: 'prov-1',
          category: 'veterinary',
          name: 'Test Vet',
          businessName: null,
          neighborhoods: ['Phillips'],
          languages: ['en'],
          specialties: ['dogs'],
          lowBono: true,
          status: 'active',
        },
      ];
      mockGroupBy.mockReturnValueOnce([]);

      await service.search('admin-1', {
        category: 'veterinary',
      });

      // Should log the lookup
      expect(mockInsert).toHaveBeenCalled();
      const lookupInsert = dbInsertValues.find(v => v.adminId === 'admin-1');
      expect(lookupInsert).toBeDefined();
      expect(lookupInsert.category).toBe('veterinary');
    });

    it('filters by neighborhood post-query', async () => {
      dbSelectResults = [
        { id: 'p1', neighborhoods: ['Phillips', 'Seward'], name: 'A', specialties: [], lowBono: false, languages: ['en'], status: 'active' },
        { id: 'p2', neighborhoods: ['Bloomington'], name: 'B', specialties: [], lowBono: false, languages: ['en'], status: 'active' },
      ];
      mockGroupBy.mockReturnValueOnce([]);

      const results = await service.search('admin-1', {
        neighborhood: 'Phillips',
      });

      // Only the Phillips provider should match
      expect(results.filter(r => r.id === 'p2')).toHaveLength(0);
    });

    it('filters by low-bono flag', async () => {
      dbSelectResults = [
        { id: 'p1', name: 'Free Clinic', lowBono: true, neighborhoods: [], specialties: [], languages: ['en'], status: 'active' },
        { id: 'p2', name: 'Expensive Clinic', lowBono: false, neighborhoods: [], specialties: [], languages: ['en'], status: 'active' },
      ];
      mockGroupBy.mockReturnValueOnce([]);

      const results = await service.search('admin-1', {
        lowBono: true,
      });

      expect(results.filter(r => r.id === 'p2')).toHaveLength(0);
    });

    it('filters by language', async () => {
      dbSelectResults = [
        { id: 'p1', name: 'Spanish Clinic', languages: ['en', 'es'], neighborhoods: [], specialties: [], lowBono: false, status: 'active' },
        { id: 'p2', name: 'English Only', languages: ['en'], neighborhoods: [], specialties: [], lowBono: false, status: 'active' },
      ];
      mockGroupBy.mockReturnValueOnce([]);

      const results = await service.search('admin-1', {
        languages: ['es'],
      });

      expect(results.filter(r => r.id === 'p2')).toHaveLength(0);
    });

    it('text search matches name, specialties, and notes', async () => {
      dbSelectResults = [
        { id: 'p1', name: 'Dr. Smith', businessName: null, specialties: ['family law'], notes: null, neighborhoods: [], languages: ['en'], lowBono: false, status: 'active' },
        { id: 'p2', name: 'Dr. Jones', businessName: null, specialties: ['criminal'], notes: null, neighborhoods: [], languages: ['en'], lowBono: false, status: 'active' },
      ];
      mockGroupBy.mockReturnValueOnce([]);

      const results = await service.search('admin-1', {
        query: 'family law',
      });

      expect(results.find(r => r.id === 'p1')).toBeDefined();
      expect(results.filter(r => r.id === 'p2')).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('returns categorized provider counts', async () => {
      dbSelectResults = [
        { id: 'p1', status: 'active', category: 'medical' },
        { id: 'p2', status: 'active', category: 'medical' },
        { id: 'p3', status: 'active', category: 'legal' },
        { id: 'p4', status: 'under_review', category: 'automotive' },
        { id: 'p5', status: 'inactive', category: 'dental' },
      ];

      const stats = await service.getStats();
      expect(stats.totalProviders).toBe(5);
      expect(stats.activeProviders).toBe(3);
      expect(stats.underReview).toBe(1);
      expect(stats.categoryBreakdown.medical).toBe(2);
      expect(stats.categoryBreakdown.legal).toBe(1);
    });
  });
});
