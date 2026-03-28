import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock expo-secure-store
const secureStore: Record<string, string> = {};
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStore[key] = value;
  }),
  getItemAsync: vi.fn(async (key: string) => secureStore[key] ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    delete secureStore[key];
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import {
  requestOtp,
  verifyOtp,
  checkIn,
  pollStatus,
  downloadRoute,
  syncUpdates,
  confirmPurge,
  getProfile,
  updateProfile,
  getZones,
} from '../api';
import { saveToken } from '../storage';

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  // Clear secure store
  for (const key of Object.keys(secureStore)) {
    delete secureStore[key];
  }
});

describe('requestOtp', () => {
  it('sends POST to /auth/otp with phone and pin', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));

    await requestOtp('+15551234567', '1234');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/auth/otp');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.phone).toBe('+15551234567');
    expect(body.pin).toBe('1234');
  });

  it('does not include Authorization header (noAuth endpoint)', async () => {
    await saveToken('existing-token');
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));

    await requestOtp('+15551234567', '1234');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });
});

describe('verifyOtp', () => {
  it('sends POST to /auth/verify and returns token', async () => {
    mockFetch.mockReturnValue(jsonResponse({ token: 'jwt-new-token' }));

    const result = await verifyOtp('+15551234567', '123456');

    expect(result.token).toBe('jwt-new-token');
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/auth/verify');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.phone).toBe('+15551234567');
    expect(body.code).toBe('123456');
  });
});

describe('checkIn', () => {
  it('sends POST to /driver/check-in', async () => {
    await saveToken('driver-jwt');
    mockFetch.mockReturnValue(jsonResponse({ sessionId: 'sess-1' }));

    const result = await checkIn();

    expect(result.sessionId).toBe('sess-1');
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/driver/check-in');
    expect(options.method).toBe('POST');
  });
});

describe('auth header inclusion', () => {
  it('includes Authorization header when token exists', async () => {
    await saveToken('my-jwt-token');
    mockFetch.mockReturnValue(jsonResponse({ routesReady: false, sessionId: 's1' }));

    await pollStatus();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('omits Authorization header when no token is stored', async () => {
    mockFetch.mockReturnValue(jsonResponse({ routesReady: false, sessionId: 's1' }));

    await pollStatus();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });
});

describe('syncUpdates', () => {
  it('sends correct payload format', async () => {
    await saveToken('driver-jwt');
    mockFetch.mockReturnValue(jsonResponse({ accepted: 2 }));

    const updates = [
      { deliveryId: 'd1', status: 'delivered', timestamp: '2026-01-01T12:00:00Z' },
      { deliveryId: 'd2', status: 'in_transit', timestamp: '2026-01-01T12:05:00Z' },
    ];

    const result = await syncUpdates(updates);

    expect(result.accepted).toBe(2);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/driver/sync');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.updates).toHaveLength(2);
    expect(body.updates[0].deliveryId).toBe('d1');
  });
});

describe('API methods use correct HTTP methods and paths', () => {
  beforeEach(async () => {
    await saveToken('jwt');
  });

  it('pollStatus sends GET to /driver/status', async () => {
    mockFetch.mockReturnValue(jsonResponse({ routesReady: true, sessionId: 's1' }));
    await pollStatus();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/driver/status');
    expect(options.method).toBe('GET');
  });

  it('downloadRoute sends GET to /driver/route', async () => {
    mockFetch.mockReturnValue(jsonResponse({ deliveries: [] }));
    await downloadRoute();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/driver/route');
    expect(options.method).toBe('GET');
  });

  it('confirmPurge sends POST to /driver/purge', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await confirmPurge();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/driver/purge');
    expect(options.method).toBe('POST');
  });

  it('getProfile sends GET to /driver/profile', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await getProfile();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/driver/profile');
    expect(options.method).toBe('GET');
  });

  it('updateProfile sends PUT to /driver/profile', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await updateProfile({
      vehicleSize: 'sedan',
      maxDeliveries: 3,
      availability: {},
      selectedZones: [],
    });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/driver/profile');
    expect(options.method).toBe('PUT');
  });

  it('getZones sends GET to /zones', async () => {
    mockFetch.mockReturnValue(jsonResponse({ zones: [] }));
    await getZones();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/zones');
    expect(options.method).toBe('GET');
  });
});
