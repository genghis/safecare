/**
 * Offline sync queue backed by encrypted IndexedDB.
 *
 * Delivery status updates are encrypted and queued locally. When the device
 * comes back online the queue is flushed to the server in order.
 */

import {
  initDB,
  storeEncrypted,
  type StoreName,
} from "@/lib/db";
import { encrypt, decrypt, getCurrentKey } from "@/lib/crypto";
import { syncUpdates } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingUpdate {
  deliveryId: string;
  status: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

/**
 * Encrypt and enqueue a delivery status update for later sync.
 */
export async function enqueueUpdate(update: PendingUpdate): Promise<void> {
  const key = getCurrentKey();
  if (!key) {
    throw new Error("No encryption key — cannot enqueue update.");
  }

  const encryptedData = await encrypt(update, key);

  const db = await initDB();
  const tx = db.transaction("syncQueue" satisfies StoreName, "readwrite");
  const store = tx.objectStore("syncQueue");

  store.add({
    data: encryptedData,
    storedAt: Date.now(),
  });

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error(`Enqueue failed: ${tx.error?.message}`));
  });
}

/**
 * Flush all queued updates to the server.
 *
 * Reads every record from the syncQueue, decrypts each one, batches them
 * into a single API call, and deletes successfully synced records.
 *
 * Returns the count of flushed and failed items.
 */
export async function flushQueue(): Promise<{
  flushed: number;
  failed: number;
}> {
  const key = getCurrentKey();
  if (!key) return { flushed: 0, failed: 0 };

  const db = await initDB();

  // Read all queued records
  const records = await new Promise<
    Array<{ id: number; data: string; storedAt: number }>
  >((resolve, reject) => {
    const tx = db.transaction("syncQueue" satisfies StoreName, "readonly");
    const store = tx.objectStore("syncQueue");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to read sync queue."));
  });

  if (records.length === 0) return { flushed: 0, failed: 0 };

  // Decrypt all updates
  const updates: Array<{ id: number; update: PendingUpdate }> = [];
  for (const record of records) {
    try {
      const update = (await decrypt(record.data, key)) as PendingUpdate;
      updates.push({ id: record.id, update });
    } catch {
      // If a record can't be decrypted (key rotated?), skip it.
      // It will be cleaned up on purgeAll().
    }
  }

  if (updates.length === 0) return { flushed: 0, failed: 0 };

  // Attempt to send them to the server
  try {
    await syncUpdates(updates.map((u) => u.update));

    // Delete successfully synced records
    const deleteTx = db.transaction(
      "syncQueue" satisfies StoreName,
      "readwrite",
    );
    const deleteStore = deleteTx.objectStore("syncQueue");
    for (const { id } of updates) {
      deleteStore.delete(id);
    }
    await new Promise<void>((resolve, reject) => {
      deleteTx.oncomplete = () => resolve();
      deleteTx.onerror = () => reject(deleteTx.error);
    });

    return { flushed: updates.length, failed: 0 };
  } catch {
    // Network or server error — leave items in queue for retry.
    return { flushed: 0, failed: updates.length };
  }
}

/**
 * Get the number of updates waiting to be synced.
 */
export async function getPendingCount(): Promise<number> {
  const db = await initDB();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction("syncQueue" satisfies StoreName, "readonly");
    const store = tx.objectStore("syncQueue");
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to count sync queue."));
  });
}

// ---------------------------------------------------------------------------
// Auto-sync timer
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 15_000; // 15 seconds
let timerId: ReturnType<typeof setInterval> | null = null;

/**
 * Start a recurring timer that flushes the sync queue when the device is
 * online. Safe to call multiple times — subsequent calls are no-ops.
 */
export function startAutoSync(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (timerId !== null) return;

  timerId = setInterval(async () => {
    if (navigator.onLine) {
      try {
        await flushQueue();
      } catch {
        // Swallow — will retry on next interval.
      }
    }
  }, intervalMs);
}

/**
 * Stop the auto-sync timer.
 */
export function stopAutoSync(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}
