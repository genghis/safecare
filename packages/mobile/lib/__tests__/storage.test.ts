import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock expo-secure-store before importing the module under test
vi.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItemAsync: vi.fn(async (key: string) => store[key] ?? null),
    deleteItemAsync: vi.fn(async (key: string) => {
      delete store[key];
    }),
  };
});

// We need to re-import fresh for each test to reset in-memory state
let storage: typeof import('../storage');

beforeEach(async () => {
  vi.resetModules();
  // Re-mock after resetModules
  vi.mock('expo-secure-store', () => {
    const store: Record<string, string> = {};
    return {
      setItemAsync: vi.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      getItemAsync: vi.fn(async (key: string) => store[key] ?? null),
      deleteItemAsync: vi.fn(async (key: string) => {
        delete store[key];
      }),
    };
  });
  storage = await import('../storage');
});

describe('setRouteData / getRouteData', () => {
  it('stores data in memory and retrieves it', () => {
    const deliveries = [
      { id: 'd1', sequence: 1, address: '100 Main St', notes: '', status: 'pending' as const },
    ];
    storage.setRouteData(deliveries);
    expect(storage.getRouteData()).toEqual(deliveries);
  });

  it('getRouteData returns null when nothing is stored', () => {
    expect(storage.getRouteData()).toBeNull();
  });
});

describe('clearAll', () => {
  it('removes all stored data (route data + token)', async () => {
    const deliveries = [
      { id: 'd1', sequence: 1, address: '100 Main St', notes: '', status: 'pending' as const },
    ];
    storage.setRouteData(deliveries);
    await storage.saveToken('jwt-token-abc');

    await storage.clearAll();

    expect(storage.getRouteData()).toBeNull();
    const token = await storage.getToken();
    expect(token).toBeNull();
  });

  it('after clearAll, getRouteData returns null', async () => {
    storage.setRouteData([
      { id: 'd2', sequence: 1, address: '200 Elm St', notes: '', status: 'delivered' as const },
    ]);
    await storage.clearAll();
    expect(storage.getRouteData()).toBeNull();
  });
});

describe('route data is isolated from token storage', () => {
  it('setting route data does not affect token', async () => {
    await storage.saveToken('my-token');
    storage.setRouteData([
      { id: 'd3', sequence: 1, address: '300 Oak Ave', notes: '', status: 'in_transit' as const },
    ]);
    const token = await storage.getToken();
    expect(token).toBe('my-token');
  });

  it('removing token does not affect route data', async () => {
    storage.setRouteData([
      { id: 'd4', sequence: 2, address: '400 Pine Blvd', notes: '', status: 'pending' as const },
    ]);
    await storage.saveToken('token-xyz');
    await storage.removeToken();

    expect(storage.getRouteData()).toHaveLength(1);
    expect(storage.getRouteData()![0].id).toBe('d4');
  });
});
