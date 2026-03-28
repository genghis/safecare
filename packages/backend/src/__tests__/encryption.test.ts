import { describe, it, expect } from 'vitest';
import {
  encryptSQL,
  decryptSQL,
  hmacSQL,
  generateSessionKey,
  generateDownloadToken,
  generateOTP,
} from '@safecare/shared';

// ---------------------------------------------------------------------------
// SQL expression builders
// ---------------------------------------------------------------------------

describe('SQL expression builders', () => {
  describe('encryptSQL', () => {
    it('returns a correct pgp_sym_encrypt expression', () => {
      const result = encryptSQL('name', '$1');
      expect(result).toBe('pgp_sym_encrypt(name, $1)');
    });

    it('works with different column and param names', () => {
      const result = encryptSQL("'some_value'", '$3');
      expect(result).toBe("pgp_sym_encrypt('some_value', $3)");
    });
  });

  describe('decryptSQL', () => {
    it('returns a correct pgp_sym_decrypt expression', () => {
      const result = decryptSQL('name_enc', '$1');
      expect(result).toBe('pgp_sym_decrypt(name_enc, $1)');
    });
  });

  describe('hmacSQL', () => {
    it('returns a correct hmac expression', () => {
      const result = hmacSQL('phone', '$2');
      expect(result).toBe("hmac(phone, $2, 'sha256')");
    });
  });
});

// ---------------------------------------------------------------------------
// Random value generators
// ---------------------------------------------------------------------------

describe('generateSessionKey', () => {
  it('returns a 64-character hex string (32 bytes)', () => {
    const key = generateSessionKey();
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different values on successive calls (randomness)', () => {
    const keys = new Set(Array.from({ length: 10 }, () => generateSessionKey()));
    // All 10 should be unique — collision probability is negligible for 32 bytes
    expect(keys.size).toBe(10);
  });
});

describe('generateDownloadToken', () => {
  it('returns a URL-safe base64 string (no +, /, or = padding)', () => {
    const token = generateDownloadToken();
    expect(token.length).toBeGreaterThan(0);
    // URL-safe base64 uses only these characters
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces tokens of consistent length (48 bytes -> 64 base64url chars)', () => {
    const token = generateDownloadToken();
    expect(token).toHaveLength(64);
  });
});

describe('generateOTP', () => {
  it('returns exactly 6 digits', () => {
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{6}$/);
    expect(otp).toHaveLength(6);
  });

  it('pads small numbers with leading zeros', () => {
    // Generate many OTPs and verify they all have 6 chars
    for (let i = 0; i < 100; i++) {
      const otp = generateOTP();
      expect(otp).toHaveLength(6);
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it('produces different values across multiple calls (randomness)', () => {
    const otps = new Set(Array.from({ length: 50 }, () => generateOTP()));
    // With 1M possible values and 50 samples, duplicates are statistically unlikely
    expect(otps.size).toBeGreaterThan(1);
  });
});
