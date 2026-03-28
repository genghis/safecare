import { describe, it, expect } from 'vitest';
import {
  generateSessionKey,
  generateOTP,
  generateDownloadToken,
  encryptSQL,
  decryptSQL,
  hmacSQL,
} from '../crypto';

describe('generateSessionKey', () => {
  it('returns a 64-character hex string', () => {
    const key = generateSessionKey();
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is random — 100 calls produce all unique values', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateSessionKey()));
    expect(keys.size).toBe(100);
  });
});

describe('generateOTP', () => {
  it('returns exactly 6 digits', () => {
    const otp = generateOTP();
    expect(otp).toHaveLength(6);
  });

  it('is always numeric (no letters)', () => {
    for (let i = 0; i < 100; i++) {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it('is random — 100 calls are not all identical', () => {
    const otps = new Set(Array.from({ length: 100 }, () => generateOTP()));
    expect(otps.size).toBeGreaterThan(1);
  });
});

describe('generateDownloadToken', () => {
  it('returns URL-safe base64 (no +, /, or = characters)', () => {
    const token = generateDownloadToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is random — 100 calls produce all unique values', () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateDownloadToken())
    );
    expect(tokens.size).toBe(100);
  });
});

describe('encryptSQL', () => {
  it('produces correct SQL expression', () => {
    expect(encryptSQL('name', '$1')).toBe('pgp_sym_encrypt(name, $1)');
    expect(encryptSQL('address', '$2')).toBe('pgp_sym_encrypt(address, $2)');
  });
});

describe('decryptSQL', () => {
  it('produces correct SQL expression', () => {
    expect(decryptSQL('name', '$1')).toBe('pgp_sym_decrypt(name, $1)');
    expect(decryptSQL('address', '$2')).toBe('pgp_sym_decrypt(address, $2)');
  });
});

describe('hmacSQL', () => {
  it('produces correct SQL expression', () => {
    expect(hmacSQL('phone', '$1')).toBe("hmac(phone, $1, 'sha256')");
    expect(hmacSQL('email', '$3')).toBe("hmac(email, $3, 'sha256')");
  });
});
