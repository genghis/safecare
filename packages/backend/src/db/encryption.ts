import { sql } from 'drizzle-orm';

/**
 * Returns a SQL expression that encrypts a plaintext value using pgp_sym_encrypt.
 */
export function encryptField(value: string, dek: string) {
  return sql`pgp_sym_encrypt(${value}, ${dek})`;
}

/**
 * Returns a SQL expression that decrypts a bytea column using pgp_sym_decrypt.
 */
export function decryptField(column: any, dek: string) {
  return sql`pgp_sym_decrypt(${column}::bytea, ${dek})`;
}

/**
 * Returns a SQL expression that computes an HMAC-SHA256 digest, hex-encoded.
 */
export function hmacField(value: string, key: string) {
  return sql`encode(hmac(${value}, ${key}, 'sha256'), 'hex')`;
}
