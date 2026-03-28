/**
 * Tests for the offline sync queue.
 */

import { vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEncrypt = vi.fn(async (data: unknown) => `enc:${JSON.stringify(data)}`);
const mockDecrypt = vi.fn(async (data: string) => {
  if (data.startsWith('enc:')) return JSON.parse(data.slice(4));
  throw new Error('bad decrypt');
});
const mockGetCurrentKey = vi.fn(() => 'mock-key');

vi.mock('@/lib/crypto', () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
  getCurrentKey: () => mockGetCurrentKey(),
}));

const mockSyncUpdates = vi.fn();
vi.mock('@/lib/api', () => ({
  syncUpdates: (...args: any[]) => mockSyncUpdates(...args),
}));

// Fake IndexedDB records
let queueRecords: Array<{ id: number; data: string; storedAt: number }>;
let nextId: number;

function makeMockObjectStore() {
  return {
    add: vi.fn((record: any) => {
      const id = nextId++;
      queueRecords.push({ id, ...record });
      return { onsuccess: null, onerror: null, result: undefined };
    }),
    getAll: vi.fn(() => {
      const req = {
        result: [...queueRecords],
        onsuccess: null as any,
        onerror: null as any,
      };
      queueMicrotask(() => req.onsuccess?.(new Event('success')));
      return req;
    }),
    count: vi.fn(() => {
      const req = {
        result: queueRecords.length,
        onsuccess: null as any,
        onerror: null as any,
      };
      queueMicrotask(() => req.onsuccess?.(new Event('success')));
      return req;
    }),
    delete: vi.fn((id: number) => {
      queueRecords = queueRecords.filter((r) => r.id !== id);
      return { onsuccess: null, onerror: null, result: undefined };
    }),
  };
}

let mockStore: ReturnType<typeof makeMockObjectStore>;

function makeMockTx() {
  return {
    objectStore: vi.fn(() => mockStore),
    oncomplete: null as any,
    onerror: null as any,
  };
}

const mockDB = {
  transaction: vi.fn(() => {
    const tx = makeMockTx();
    queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
    return tx;
  }),
};

vi.mock('@/lib/db', async () => {
  return {
    initDB: vi.fn(async () => mockDB),
    storeEncrypted: vi.fn(),
    type: {} as any,
  };
});

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  enqueueUpdate,
  flushQueue,
  getPendingCount,
  startAutoSync,
  stopAutoSync,
  type PendingUpdate,
} from '@/lib/sync';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  queueRecords = [];
  nextId = 1;
  mockStore = makeMockObjectStore();
  mockSyncUpdates.mockReset();
  mockSyncUpdates.mockResolvedValue({ accepted: 0 });
  mockEncrypt.mockClear();
  mockDecrypt.mockClear();
  mockGetCurrentKey.mockReturnValue('mock-key');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const sampleUpdate: PendingUpdate = {
  deliveryId: 'del-1',
  status: 'delivered',
  timestamp: '2026-03-28T12:00:00Z',
};

describe('enqueueUpdate', () => {
  it('encrypts and stores update in IndexedDB', async () => {
    await enqueueUpdate(sampleUpdate);

    expect(mockEncrypt).toHaveBeenCalledWith(sampleUpdate, 'mock-key');
    expect(mockStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        data: `enc:${JSON.stringify(sampleUpdate)}`,
        storedAt: expect.any(Number),
      }),
    );
  });

  it('throws when no encryption key is available', async () => {
    mockGetCurrentKey.mockReturnValue(null);
    await expect(enqueueUpdate(sampleUpdate)).rejects.toThrow(
      'No encryption key',
    );
  });
});

describe('flushQueue', () => {
  it('sends all queued updates to server', async () => {
    queueRecords = [
      { id: 1, data: `enc:${JSON.stringify(sampleUpdate)}`, storedAt: 1 },
      {
        id: 2,
        data: `enc:${JSON.stringify({ ...sampleUpdate, deliveryId: 'del-2' })}`,
        storedAt: 2,
      },
    ];

    const result = await flushQueue();

    expect(mockSyncUpdates).toHaveBeenCalledWith([
      sampleUpdate,
      { ...sampleUpdate, deliveryId: 'del-2' },
    ]);
    expect(result.flushed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('removes successfully sent updates', async () => {
    queueRecords = [
      { id: 1, data: `enc:${JSON.stringify(sampleUpdate)}`, storedAt: 1 },
    ];

    await flushQueue();

    // The delete method should have been called for the sent record
    expect(mockStore.delete).toHaveBeenCalledWith(1);
  });

  it('keeps failed updates for retry', async () => {
    queueRecords = [
      { id: 1, data: `enc:${JSON.stringify(sampleUpdate)}`, storedAt: 1 },
    ];
    mockSyncUpdates.mockRejectedValue(new Error('Network error'));

    const result = await flushQueue();

    expect(result.flushed).toBe(0);
    expect(result.failed).toBe(1);
    // delete should NOT have been called
    expect(mockStore.delete).not.toHaveBeenCalled();
  });

  it('returns zeros when no key is available', async () => {
    mockGetCurrentKey.mockReturnValue(null);
    const result = await flushQueue();
    expect(result).toEqual({ flushed: 0, failed: 0 });
  });
});

describe('getPendingCount', () => {
  it('returns correct count', async () => {
    queueRecords = [
      { id: 1, data: 'enc:"a"', storedAt: 1 },
      { id: 2, data: 'enc:"b"', storedAt: 2 },
      { id: 3, data: 'enc:"c"', storedAt: 3 },
    ];

    const count = await getPendingCount();
    expect(count).toBe(3);
  });
});

describe('startAutoSync / stopAutoSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopAutoSync(); // ensure clean state
  });

  afterEach(() => {
    stopAutoSync();
    vi.useRealTimers();
  });

  it('creates an interval that can be cleared', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    startAutoSync(5000);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

    stopAutoSync();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('subsequent startAutoSync calls are no-ops', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    startAutoSync(5000);
    startAutoSync(5000);
    startAutoSync(5000);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('flushQueue is skipped when offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    queueRecords = [
      { id: 1, data: `enc:${JSON.stringify(sampleUpdate)}`, storedAt: 1 },
    ];

    startAutoSync(1000);
    vi.advanceTimersByTime(1000);

    // syncUpdates should NOT have been called because we're offline
    expect(mockSyncUpdates).not.toHaveBeenCalled();

    // Restore
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
  });
});
