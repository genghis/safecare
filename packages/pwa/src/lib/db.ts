/**
 * Encrypted IndexedDB wrapper.
 *
 * Every value written to the database is AES-GCM encrypted via the crypto
 * module before storage and decrypted on read. The only thing stored in
 * cleartext is the record key (needed for IndexedDB lookups).
 */

import { encrypt, decrypt, getCurrentKey, destroyKey } from "@/lib/crypto";

const DB_NAME = "safecare-driver";
const DB_VERSION = 1;

const STORE_NAMES = ["routes", "syncQueue", "profile", "session"] as const;
export type StoreName = (typeof STORE_NAMES)[number];

// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

let dbInstance: IDBDatabase | null = null;

export function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("routes")) {
        db.createObjectStore("routes", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
      if (!db.objectStoreNames.contains("profile")) {
        db.createObjectStore("profile", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("session")) {
        db.createObjectStore("session", { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // If the database is unexpectedly closed (e.g. storage pressure),
      // clear the cached reference so the next call reopens it.
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error(`IndexedDB open failed: ${request.error?.message}`));
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireKey(): CryptoKey {
  const key = getCurrentKey();
  if (!key) {
    throw new Error(
      "No encryption key available. Call deriveKey() or generateEphemeralKey() first.",
    );
  }
  return key;
}

function tx(
  db: IDBDatabase,
  storeName: StoreName,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(`IDB request failed: ${request.error?.message}`));
  });
}

// ---------------------------------------------------------------------------
// CRUD operations (all encrypted)
// ---------------------------------------------------------------------------

/**
 * Encrypt `data` and store it under the given key in the specified store.
 */
export async function storeEncrypted(
  storeName: StoreName,
  key: string,
  data: unknown,
): Promise<void> {
  const cryptoKey = requireKey();
  const encryptedData = await encrypt(data, cryptoKey);

  const db = await initDB();
  const store = tx(db, storeName, "readwrite");

  await wrap(
    store.put({
      id: key,
      data: encryptedData,
      storedAt: Date.now(),
    }),
  );
}

/**
 * Read a record from the store, decrypt it, and return the parsed data.
 * Returns `null` if the key does not exist.
 */
export async function readEncrypted(
  storeName: StoreName,
  key: string,
): Promise<unknown | null> {
  const cryptoKey = requireKey();

  const db = await initDB();
  const store = tx(db, storeName, "readonly");
  const record = await wrap(store.get(key));

  if (!record) return null;

  return decrypt(
    (record as { id: string; data: string; storedAt: number }).data,
    cryptoKey,
  );
}

/**
 * Delete a single record from a store.
 */
export async function deleteFromStore(
  storeName: StoreName,
  key: string,
): Promise<void> {
  const db = await initDB();
  const store = tx(db, storeName, "readwrite");
  await wrap(store.delete(key));
}

/**
 * Clear all records from a single store.
 */
export async function clearStore(storeName: StoreName): Promise<void> {
  const db = await initDB();
  const store = tx(db, storeName, "readwrite");
  await wrap(store.clear());
}

/**
 * Nuclear option: clear ALL stores and destroy the encryption key.
 * Used at end-of-shift to ensure no PII remains on the device.
 */
export async function purgeAll(): Promise<void> {
  const db = await initDB();

  for (const storeName of STORE_NAMES) {
    const store = tx(db, storeName, "readwrite");
    await wrap(store.clear());
  }

  destroyKey();
}

/**
 * Check whether the stored session has expired.
 *
 * Reads `expiresAt` from the "session" store. Returns `true` if the session
 * has expired (or if no session exists). Called on every app foreground to
 * implement TTL-based auto-purge.
 */
export async function checkExpiry(): Promise<boolean> {
  const cryptoKey = getCurrentKey();

  // If there is no key, there is no session to expire — nothing to purge.
  if (!cryptoKey) return false;

  try {
    const db = await initDB();
    const store = tx(db, "session", "readonly");
    const record = await wrap(store.get("expiresAt"));

    if (!record) return true;

    const expiresAt = await decrypt(
      (record as { key: string; data: string }).data,
      cryptoKey,
    );

    if (typeof expiresAt !== "number") return true;

    return Date.now() > expiresAt;
  } catch {
    // If decryption fails (e.g. key was rotated), treat as expired.
    return true;
  }
}
