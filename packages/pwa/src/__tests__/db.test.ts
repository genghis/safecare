/**
 * Tests for encrypted IndexedDB wrapper.
 *
 * Since IndexedDB is not available in vitest/jsdom, we mock the db module's
 * internal dependencies (crypto, IndexedDB) and verify the encrypt/decrypt
 * flow and business logic.
 */

import { vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mock crypto module
// ---------------------------------------------------------------------------

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn(async (data: unknown) => `encrypted:${JSON.stringify(data)}`),
  decrypt: vi.fn(async (encrypted: string) => {
    const prefix = 'encrypted:';
    if (encrypted.startsWith(prefix)) {
      return JSON.parse(encrypted.slice(prefix.length));
    }
    throw new Error('Decryption failed');
  }),
  getCurrentKey: vi.fn(() => 'mock-crypto-key'),
  destroyKey: vi.fn(),
  clearSessionKey: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  clearToken: vi.fn(),
}));

vi.mock('@/lib/tile-cache', () => ({
  clearTileCache: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Fake IndexedDB helpers
// ---------------------------------------------------------------------------

function createMockStore(records: Map<string, any> = new Map()) {
  return {
    put: vi.fn((record: any) => {
      records.set(record.id ?? record.key, record);
      return createRequest(undefined);
    }),
    get: vi.fn((key: string) => {
      return createRequest(records.get(key) ?? null);
    }),
    clear: vi.fn(() => createRequest(undefined)),
    delete: vi.fn((key: string) => {
      records.delete(key);
      return createRequest(undefined);
    }),
  };
}

function createRequest(result: any): IDBRequest {
  const req = {
    result,
    error: null,
    onsuccess: null as any,
    onerror: null as any,
  } as unknown as IDBRequest;

  // Fire onsuccess on next tick
  queueMicrotask(() => {
    if (req.onsuccess) {
      req.onsuccess(new Event('success'));
    }
  });

  return req;
}

function createMockDB(stores: Record<string, ReturnType<typeof createMockStore>>) {
  return {
    transaction: vi.fn((storeName: string) => ({
      objectStore: vi.fn(() => stores[storeName]),
    })),
    objectStoreNames: { contains: vi.fn(() => true) },
    onclose: null,
  } as unknown as IDBDatabase;
}

// ---------------------------------------------------------------------------
// Mock IndexedDB.open
// ---------------------------------------------------------------------------

let sessionStore: ReturnType<typeof createMockStore>;
let routesStore: ReturnType<typeof createMockStore>;
let syncQueueStore: ReturnType<typeof createMockStore>;
let profileStore: ReturnType<typeof createMockStore>;
let mockDB: ReturnType<typeof createMockDB>;

function setupMockIndexedDB() {
  sessionStore = createMockStore();
  routesStore = createMockStore();
  syncQueueStore = createMockStore();
  profileStore = createMockStore();

  mockDB = createMockDB({
    session: sessionStore,
    routes: routesStore,
    syncQueue: syncQueueStore,
    profile: profileStore,
  });

  const openRequest = {
    result: mockDB,
    error: null,
    onsuccess: null as any,
    onerror: null as any,
    onupgradeneeded: null as any,
  };

  const mockOpen = vi.fn(() => {
    queueMicrotask(() => {
      if (openRequest.onsuccess) {
        openRequest.onsuccess(new Event('success'));
      }
    });
    return openRequest;
  });

  vi.stubGlobal('indexedDB', { open: mockOpen });
}

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are in place
// ---------------------------------------------------------------------------

// We need to re-import for each test to reset the cached dbInstance
let db: typeof import('@/lib/db');

beforeEach(async () => {
  vi.resetModules();
  setupMockIndexedDB();
  db = await import('@/lib/db');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('storeEncrypted', () => {
  it('calls encrypt before writing to IndexedDB', async () => {
    const { encrypt } = await import('@/lib/crypto');

    await db.storeEncrypted('routes', 'route-1', { stops: [1, 2, 3] });

    expect(encrypt).toHaveBeenCalledWith(
      { stops: [1, 2, 3] },
      'mock-crypto-key',
    );
    expect(routesStore.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'route-1',
        data: 'encrypted:{"stops":[1,2,3]}',
        storedAt: expect.any(Number),
      }),
    );
  });
});

describe('readEncrypted', () => {
  it('calls decrypt after reading from IndexedDB', async () => {
    const { decrypt } = await import('@/lib/crypto');

    // Pre-populate the store
    const records = new Map();
    records.set('route-1', {
      id: 'route-1',
      data: 'encrypted:{"stops":[1,2,3]}',
      storedAt: Date.now(),
    });

    // Rebuild with pre-populated data
    const populatedStore = createMockStore(records);
    (mockDB.transaction as Mock).mockImplementation((storeName: string) => ({
      objectStore: vi.fn(() =>
        storeName === 'routes' ? populatedStore : sessionStore,
      ),
    }));

    const result = await db.readEncrypted('routes', 'route-1');

    expect(decrypt).toHaveBeenCalledWith(
      'encrypted:{"stops":[1,2,3]}',
      'mock-crypto-key',
    );
    expect(result).toEqual({ stops: [1, 2, 3] });
  });
});

describe('purgeAll', () => {
  it('clears all stores and destroys the crypto key', async () => {
    const { destroyKey } = await import('@/lib/crypto');

    await db.purgeAll();

    // All four stores should have been cleared
    expect(routesStore.clear).toHaveBeenCalled();
    expect(syncQueueStore.clear).toHaveBeenCalled();
    expect(profileStore.clear).toHaveBeenCalled();
    expect(sessionStore.clear).toHaveBeenCalled();

    // Crypto key should be destroyed
    expect(destroyKey).toHaveBeenCalled();
  });
});

describe('checkExpiry', () => {
  it('returns true when session is expired', async () => {
    const { getCurrentKey } = await import('@/lib/crypto');
    (getCurrentKey as Mock).mockReturnValue('mock-key');

    // Store an expiresAt in the past
    const pastTimestamp = Date.now() - 60_000;
    const records = new Map();
    records.set('expiresAt', {
      key: 'expiresAt',
      data: `encrypted:${pastTimestamp}`,
    });

    const populatedSession = createMockStore(records);
    (mockDB.transaction as Mock).mockImplementation(() => ({
      objectStore: vi.fn(() => populatedSession),
    }));

    const expired = await db.checkExpiry();
    expect(expired).toBe(true);
  });

  it('returns false when session is NOT expired', async () => {
    const { getCurrentKey } = await import('@/lib/crypto');
    (getCurrentKey as Mock).mockReturnValue('mock-key');

    // Store an expiresAt in the future
    const futureTimestamp = Date.now() + 3_600_000; // +1 hour
    const records = new Map();
    records.set('expiresAt', {
      key: 'expiresAt',
      data: `encrypted:${futureTimestamp}`,
    });

    const populatedSession = createMockStore(records);
    (mockDB.transaction as Mock).mockImplementation(() => ({
      objectStore: vi.fn(() => populatedSession),
    }));

    const expired = await db.checkExpiry();
    expect(expired).toBe(false);
  });

  it('returns false when no session record exists (nothing to expire)', async () => {
    const { getCurrentKey } = await import('@/lib/crypto');
    (getCurrentKey as Mock).mockReturnValue('mock-key');

    // Empty session store — get returns null → no active session, nothing to purge
    const emptySession = createMockStore();
    (mockDB.transaction as Mock).mockImplementation(() => ({
      objectStore: vi.fn(() => emptySession),
    }));

    const expired = await db.checkExpiry();
    expect(expired).toBe(false);
  });

  it('returns false when no crypto key exists (nothing to expire)', async () => {
    const { getCurrentKey } = await import('@/lib/crypto');
    (getCurrentKey as Mock).mockReturnValue(null);

    // No key means no active session → nothing to purge
    const expired = await db.checkExpiry();
    expect(expired).toBe(false);
  });
});

describe('emergencyPurge', () => {
  it('clears all stores, destroys key, clears sessionStorage, clears token, and deletes database', async () => {
    const { destroyKey, clearSessionKey } = await import('@/lib/crypto');
    const { clearToken } = await import('@/lib/api');
    const { clearTileCache } = await import('@/lib/tile-cache');

    const mockDeleteDatabase = vi.fn();
    vi.stubGlobal('indexedDB', {
      ...globalThis.indexedDB,
      open: (globalThis.indexedDB as any).open,
      deleteDatabase: mockDeleteDatabase,
    });

    await db.emergencyPurge();

    // All stores should be cleared
    expect(routesStore.clear).toHaveBeenCalled();
    expect(syncQueueStore.clear).toHaveBeenCalled();
    expect(profileStore.clear).toHaveBeenCalled();
    expect(sessionStore.clear).toHaveBeenCalled();

    // Crypto key destroyed
    expect(destroyKey).toHaveBeenCalled();

    // Session key cleared from sessionStorage
    expect(clearSessionKey).toHaveBeenCalled();

    // JWT cleared
    expect(clearToken).toHaveBeenCalled();

    // Tile cache cleared
    expect(clearTileCache).toHaveBeenCalled();

    // Database deletion attempted
    expect(mockDeleteDatabase).toHaveBeenCalledWith('safecare-driver');
  });
});
