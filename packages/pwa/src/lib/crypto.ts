/**
 * Client-side encryption for IndexedDB using the Web Crypto API (SubtleCrypto).
 *
 * All route data is encrypted at rest with AES-GCM-256. Keys are derived from
 * server-provided session keys via HKDF, or generated ephemerally for
 * pre-download local-only encryption.
 *
 * No external dependencies — standard Web Crypto API only.
 */

const HKDF_SALT = new TextEncoder().encode("safecare-pwa-hkdf-salt-v1");
const HKDF_INFO = new TextEncoder().encode("safecare-pwa-storage");
const IV_LENGTH = 12; // bytes, standard for AES-GCM

/** Module-level reference to the active encryption key. */
let currentKey: CryptoKey | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Key derivation & management
// ---------------------------------------------------------------------------

/**
 * Derive an AES-GCM-256 key from a server-provided session key (hex string).
 *
 * Uses HKDF with SHA-256, a fixed salt, and the info string
 * "safecare-pwa-storage" to produce a deterministic derived key.
 */
export async function deriveKey(sessionKey: string): Promise<CryptoKey> {
  const rawBytes = hexToBytes(sessionKey);

  // Import raw key material for HKDF
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    rawBytes,
    "HKDF",
    false,
    ["deriveKey"],
  );

  // Derive AES-GCM-256 key
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: HKDF_INFO,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // not extractable — stays in CryptoKey
    ["encrypt", "decrypt"],
  );

  currentKey = derivedKey;
  return derivedKey;
}

/**
 * Encrypt arbitrary data for storage.
 *
 * Serialises `data` to JSON, generates a random 12-byte IV, encrypts with
 * AES-GCM, and returns a base64-encoded string of `IV || ciphertext`.
 */
export async function encrypt(data: unknown, key: CryptoKey): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  // Concatenate IV + ciphertext into a single buffer
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  return bytesToBase64(combined);
}

/**
 * Decrypt a previously encrypted string back to the original data.
 *
 * Decodes the base64 string, splits IV (first 12 bytes) from ciphertext,
 * decrypts with AES-GCM, and parses the resulting JSON.
 */
export async function decrypt(encrypted: string, key: CryptoKey): Promise<unknown> {
  const combined = base64ToBytes(encrypted);

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json);
}

/**
 * Generate an ephemeral AES-GCM-256 key for local-only encryption.
 *
 * Used before a server session key is available (e.g. encrypting profile data
 * prior to route download). Returns both the CryptoKey and its hex-encoded
 * raw export so it can be persisted if needed.
 */
export async function generateEphemeralKey(): Promise<{
  key: CryptoKey;
  exported: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can export
    ["encrypt", "decrypt"],
  );

  const rawBytes = await crypto.subtle.exportKey("raw", key);
  const exported = bytesToHex(new Uint8Array(rawBytes));

  currentKey = key;
  return { key, exported };
}

/**
 * Clear the in-memory key reference.
 *
 * After calling this, any attempt to encrypt/decrypt will require a new key
 * derivation or generation. The CryptoKey object becomes eligible for GC.
 */
export function destroyKey(): void {
  currentKey = null;
}

/**
 * Get the current in-memory CryptoKey, or null if none has been set.
 */
export function getCurrentKey(): CryptoKey | null {
  return currentKey;
}
