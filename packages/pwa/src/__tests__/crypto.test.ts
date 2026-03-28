/**
 * Tests for the Web Crypto encryption layer — the most critical security tests.
 *
 * These verify that AES-GCM-256 encryption via HKDF-derived keys actually
 * protects data at rest and that key management is correct.
 */

import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  // @ts-expect-error — webcrypto is compatible but types differ slightly
  globalThis.crypto = webcrypto;
}

import {
  deriveKey,
  encrypt,
  decrypt,
  generateEphemeralKey,
  destroyKey,
  getCurrentKey,
} from '@/lib/crypto';

// A valid 32-byte hex string (64 hex chars) to use as session key input
const SESSION_KEY_A =
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const SESSION_KEY_B =
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// ---------------------------------------------------------------------------
// deriveKey
// ---------------------------------------------------------------------------

describe('deriveKey', () => {
  afterEach(() => {
    destroyKey();
  });

  it('produces a valid CryptoKey from hex input', async () => {
    const key = await deriveKey(SESSION_KEY_A);

    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('is deterministic — same input produces same derived key', async () => {
    const key1 = await deriveKey(SESSION_KEY_A);
    const plaintext = { msg: 'determinism check' };
    const encrypted = await encrypt(plaintext, key1);

    // Derive again from the same session key
    const key2 = await deriveKey(SESSION_KEY_A);
    const decrypted = await decrypt(encrypted, key2);

    expect(decrypted).toEqual(plaintext);
  });

  it('different inputs produce different keys', async () => {
    const keyA = await deriveKey(SESSION_KEY_A);
    const keyB = await deriveKey(SESSION_KEY_B);

    // Encrypt with key A, attempt decrypt with key B — should fail
    const encrypted = await encrypt('secret data', keyA);

    await expect(decrypt(encrypted, keyB)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// encrypt
// ---------------------------------------------------------------------------

describe('encrypt', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await deriveKey(SESSION_KEY_A);
  });

  afterAll(() => {
    destroyKey();
  });

  it('returns a base64 string, not the plaintext', async () => {
    const data = 'sensitive patient info';
    const encrypted = await encrypt(data, key);

    expect(typeof encrypted).toBe('string');
    // Base64 pattern: alphanumeric + / + = padding
    expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // Must NOT contain the original plaintext
    expect(encrypted).not.toContain(data);
  });

  it('output differs each call due to random IV', async () => {
    const data = { same: 'payload' };
    const enc1 = await encrypt(data, key);
    const enc2 = await encrypt(data, key);

    // Both should decrypt to the same value, but the ciphertext must differ
    expect(enc1).not.toBe(enc2);
    expect(await decrypt(enc1, key)).toEqual(data);
    expect(await decrypt(enc2, key)).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// decrypt(encrypt(data)) round-trip
// ---------------------------------------------------------------------------

describe('encrypt/decrypt round-trip', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await deriveKey(SESSION_KEY_A);
  });

  afterAll(() => {
    destroyKey();
  });

  it('round-trips strings correctly', async () => {
    const data = 'Hello, SafeCare!';
    expect(await decrypt(await encrypt(data, key), key)).toBe(data);
  });

  it('round-trips objects correctly', async () => {
    const data = { deliveryId: '123', status: 'delivered', lat: 40.7128 };
    expect(await decrypt(await encrypt(data, key), key)).toEqual(data);
  });

  it('round-trips arrays correctly', async () => {
    const data = [1, 'two', { three: 3 }, [4, 5]];
    expect(await decrypt(await encrypt(data, key), key)).toEqual(data);
  });

  it('round-trips nested objects with special chars', async () => {
    const data = {
      name: "O'Brien",
      notes: 'Unit #4B — ring bell "twice" & wait\nnewline here',
      address: {
        street: '123 Main St.',
        emoji: '\u{1F4E6}',
        unicode: '\u00E9\u00F1\u00FC',
      },
      tags: ['fragile', '<script>alert("xss")</script>'],
    };
    expect(await decrypt(await encrypt(data, key), key)).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// decrypt failure modes
// ---------------------------------------------------------------------------

describe('decrypt failure modes', () => {
  let keyA: CryptoKey;
  let keyB: CryptoKey;

  beforeAll(async () => {
    keyA = await deriveKey(SESSION_KEY_A);
    keyB = await deriveKey(SESSION_KEY_B);
  });

  afterAll(() => {
    destroyKey();
  });

  it('decrypt with wrong key throws', async () => {
    const encrypted = await encrypt('secret', keyA);
    await expect(decrypt(encrypted, keyB)).rejects.toThrow();
  });

  it('decrypt with corrupted ciphertext throws', async () => {
    const encrypted = await encrypt('secret', keyA);

    // Flip some characters in the middle of the base64 string
    const chars = encrypted.split('');
    const mid = Math.floor(chars.length / 2);
    // Replace a stretch of characters with different ones
    for (let i = mid; i < mid + 6 && i < chars.length; i++) {
      chars[i] = chars[i] === 'A' ? 'B' : 'A';
    }
    const corrupted = chars.join('');

    await expect(decrypt(corrupted, keyA)).rejects.toThrow();
  });

  it('decrypt with truncated ciphertext throws', async () => {
    const encrypted = await encrypt('secret', keyA);
    // Truncate to just the IV portion (first ~16 base64 chars)
    const truncated = encrypted.slice(0, 16);

    await expect(decrypt(truncated, keyA)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateEphemeralKey
// ---------------------------------------------------------------------------

describe('generateEphemeralKey', () => {
  afterEach(() => {
    destroyKey();
  });

  it('produces a valid key and hex export', async () => {
    const { key, exported } = await generateEphemeralKey();

    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(typeof exported).toBe('string');
    expect(exported).toMatch(/^[0-9a-f]+$/);
  });

  it('produces different keys each call', async () => {
    const first = await generateEphemeralKey();
    const second = await generateEphemeralKey();

    expect(first.exported).not.toBe(second.exported);
  });

  it('exported key is 64 hex chars (32 bytes)', async () => {
    const { exported } = await generateEphemeralKey();
    expect(exported).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// Key lifecycle: destroyKey / getCurrentKey
// ---------------------------------------------------------------------------

describe('key lifecycle', () => {
  it('destroyKey clears the current key reference', async () => {
    await deriveKey(SESSION_KEY_A);
    expect(getCurrentKey()).not.toBeNull();

    destroyKey();
    expect(getCurrentKey()).toBeNull();
  });

  it('getCurrentKey returns null after destroyKey', async () => {
    await generateEphemeralKey();
    expect(getCurrentKey()).not.toBeNull();

    destroyKey();
    expect(getCurrentKey()).toBeNull();
  });
});
