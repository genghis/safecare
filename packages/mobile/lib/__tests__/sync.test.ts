import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock expo-network
vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(),
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', NONE: 'NONE' },
}));

// Mock the api module
vi.mock('../api', () => ({
  syncUpdates: vi.fn(),
}));

// Mock expo-secure-store (needed transitively by api -> storage)
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(async () => null),
  deleteItemAsync: vi.fn(),
}));

import * as Network from 'expo-network';
import { syncUpdates } from '../api';
import {
  enqueueStatusUpdate,
  pendingCount,
  peekQueue,
  flushSyncQueue,
  clearQueue,
} from '../sync';

const mockGetNetworkState = vi.mocked(Network.getNetworkStateAsync);
const mockSyncUpdates = vi.mocked(syncUpdates);

beforeEach(() => {
  vi.clearAllMocks();
  clearQueue();
});

const makeUpdate = (id: string) => ({
  deliveryId: id,
  status: 'delivered',
  timestamp: new Date().toISOString(),
});

describe('enqueueStatusUpdate', () => {
  it('adds to the queue', () => {
    enqueueStatusUpdate(makeUpdate('d1'));
    expect(pendingCount()).toBe(1);
    expect(peekQueue()).toHaveLength(1);
  });

  it('multiple updates accumulate correctly', () => {
    enqueueStatusUpdate(makeUpdate('d1'));
    enqueueStatusUpdate(makeUpdate('d2'));
    enqueueStatusUpdate(makeUpdate('d3'));
    expect(pendingCount()).toBe(3);
  });
});

describe('flushSyncQueue', () => {
  it('sends all queued updates when online', async () => {
    mockGetNetworkState.mockResolvedValue({
      isInternetReachable: true,
      isConnected: true,
      type: Network.NetworkStateType.WIFI as any,
    });
    mockSyncUpdates.mockResolvedValue({ accepted: 2 });

    enqueueStatusUpdate(makeUpdate('d1'));
    enqueueStatusUpdate(makeUpdate('d2'));

    const count = await flushSyncQueue();

    expect(count).toBe(2);
    expect(mockSyncUpdates).toHaveBeenCalledOnce();
    expect(mockSyncUpdates).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ deliveryId: 'd1' }),
        expect.objectContaining({ deliveryId: 'd2' }),
      ])
    );
  });

  it('clears the queue on success', async () => {
    mockGetNetworkState.mockResolvedValue({
      isInternetReachable: true,
      isConnected: true,
      type: Network.NetworkStateType.WIFI as any,
    });
    mockSyncUpdates.mockResolvedValue({ accepted: 1 });

    enqueueStatusUpdate(makeUpdate('d1'));
    await flushSyncQueue();

    expect(pendingCount()).toBe(0);
  });

  it('skips when offline', async () => {
    mockGetNetworkState.mockResolvedValue({
      isInternetReachable: false,
      isConnected: false,
      type: Network.NetworkStateType.NONE as any,
    });

    enqueueStatusUpdate(makeUpdate('d1'));
    const count = await flushSyncQueue();

    expect(count).toBe(0);
    expect(mockSyncUpdates).not.toHaveBeenCalled();
    // Queue should still have the item
    expect(pendingCount()).toBe(1);
  });
});

describe('clearQueue', () => {
  it('empties the queue', () => {
    enqueueStatusUpdate(makeUpdate('d1'));
    enqueueStatusUpdate(makeUpdate('d2'));
    expect(pendingCount()).toBe(2);

    clearQueue();
    expect(pendingCount()).toBe(0);
    expect(peekQueue()).toEqual([]);
  });
});
