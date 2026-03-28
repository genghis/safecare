/**
 * Tests for the API client (src/lib/api.ts).
 *
 * Verifies that the JWT is stored in memory (not localStorage), that auth
 * headers are correctly managed, and that error handling works as expected.
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must come before importing api.ts
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  storeEncrypted: vi.fn(),
  readEncrypted: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  getCurrentKey: vi.fn(() => ({ type: 'secret' })),
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  setToken,
  getToken,
  clearToken,
  requestOtp,
  verifyOtp,
  syncUpdates,
  getProfile,
} from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Response for fetch. */
function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(body: unknown, status = 200) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    mockResponse(body, status),
  );
}

/** Extract the most recent fetch call's headers. */
function lastFetchHeaders(): Record<string, string> {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const lastCall = calls[calls.length - 1];
  return lastCall[1]?.headers ?? {};
}

/** Extract the most recent fetch call's body (parsed). */
function lastFetchBody(): unknown {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const lastCall = calls[calls.length - 1];
  return lastCall[1]?.body ? JSON.parse(lastCall[1].body) : undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api.ts — API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToken();
    // Reset fetch mock
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  // -----------------------------------------------------------------------
  // JWT in-memory storage
  // -----------------------------------------------------------------------

  describe('JWT storage', () => {
    it('stores JWT in a memory variable, NOT in localStorage', () => {
      setToken('test-jwt-token');

      expect(getToken()).toBe('test-jwt-token');
      // Ensure localStorage was NOT used
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('jwt')).toBeNull();
    });

    it('setToken / getToken work correctly', () => {
      expect(getToken()).toBeNull();

      setToken('my-jwt');
      expect(getToken()).toBe('my-jwt');

      clearToken();
      expect(getToken()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Authorization header
  // -----------------------------------------------------------------------

  describe('Authorization header', () => {
    it('includes Authorization header when token is set', async () => {
      setToken('bearer-token-123');
      mockFetch({ zones: [] });

      // getProfile is an authenticated endpoint
      await getProfile();

      const headers = lastFetchHeaders();
      expect(headers['Authorization']).toBe('Bearer bearer-token-123');
    });

    it('does NOT include Authorization header when no token is set', async () => {
      // No token set
      mockFetch({ ok: true });

      await requestOtp('+27821234567');

      const headers = lastFetchHeaders();
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // requestOtp
  // -----------------------------------------------------------------------

  describe('requestOtp', () => {
    it('sends correct payload', async () => {
      mockFetch({ ok: true });

      await requestOtp('+27821234567');

      const body = lastFetchBody();
      expect(body).toEqual({ phone: '+27821234567' });
    });

    it('uses POST method', async () => {
      mockFetch({ ok: true });

      await requestOtp('+27821234567');

      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][1]?.method).toBe('POST');
    });
  });

  // -----------------------------------------------------------------------
  // verifyOtp
  // -----------------------------------------------------------------------

  describe('verifyOtp', () => {
    it('sends phone and code in the body', async () => {
      mockFetch({ token: 'new-jwt-token' });

      await verifyOtp('+27821234567', '123456');

      const body = lastFetchBody();
      expect(body).toEqual({ phone: '+27821234567', code: '123456' });
    });

    it('returns the token from the response', async () => {
      mockFetch({ token: 'returned-jwt' });

      const result = await verifyOtp('+27821234567', '123456');
      expect(result).toEqual({ token: 'returned-jwt' });
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('401 responses throw with status info', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      setToken('stale-token');

      await expect(getProfile()).rejects.toThrow(/401/);
    });

    it('network errors are handled gracefully (throw Error, not unhandled)', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TypeError('Failed to fetch'),
      );

      await expect(getProfile()).rejects.toThrow('Failed to fetch');
    });

    it('server errors (500) throw with status info', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(syncUpdates([])).rejects.toThrow(/500/);
    });
  });
});
