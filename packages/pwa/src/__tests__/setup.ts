/**
 * Global test setup for vitest + jsdom environment.
 */

// Polyfill Web Crypto API from Node.js if not available in jsdom
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  // @ts-expect-error — webcrypto is compatible but types differ slightly
  globalThis.crypto = webcrypto;
}

// Global fetch mock — individual tests can override via vi.mocked(fetch)
const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
  new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }),
);

vi.stubGlobal('fetch', mockFetch);

// Provide a minimal import.meta.env for api.ts
if (!(import.meta as any).env) {
  (import.meta as any).env = {};
}

// Reset mocks between tests
beforeEach(() => {
  mockFetch.mockClear();
});
