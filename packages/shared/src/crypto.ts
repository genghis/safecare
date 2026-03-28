import crypto from 'crypto';

/**
 * Returns a SQL expression that encrypts a column using pgp_sym_encrypt.
 * @param column - The column name or value to encrypt
 * @param dekParam - The parameterised placeholder for the data-encryption key (e.g. "$1")
 */
export function encryptSQL(column: string, dekParam: string): string {
  return `pgp_sym_encrypt(${column}, ${dekParam})`;
}

/**
 * Returns a SQL expression that decrypts a column using pgp_sym_decrypt.
 * @param column - The encrypted column name
 * @param dekParam - The parameterised placeholder for the data-encryption key
 */
export function decryptSQL(column: string, dekParam: string): string {
  return `pgp_sym_decrypt(${column}, ${dekParam})`;
}

/**
 * Returns a SQL expression that computes an HMAC-SHA256 digest.
 * @param column - The column name or value to hash
 * @param keyParam - The parameterised placeholder for the HMAC key
 */
export function hmacSQL(column: string, keyParam: string): string {
  return `hmac(${column}, ${keyParam}, 'sha256')`;
}

/**
 * Generates a random 32-byte hex string for use as a session key.
 */
export function generateSessionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates a 6-digit numeric OTP.
 */
export function generateOTP(): string {
  const num = crypto.randomInt(0, 1_000_000);
  return num.toString().padStart(6, '0');
}

/**
 * Generates a random 48-byte URL-safe base64 token for download links.
 */
export function generateDownloadToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}
