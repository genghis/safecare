import * as Network from "expo-network";
import { syncUpdates, type StatusUpdate } from "./api";

// ---------------------------------------------------------------------------
// Offline-first sync queue
// ---------------------------------------------------------------------------
// Delivery status updates are stored locally and flushed to the server
// whenever connectivity is available. This ensures drivers can keep working
// in airplane mode or poor-signal areas.

let _queue: StatusUpdate[] = [];

/** Add a delivery status change to the local sync queue. */
export function enqueueStatusUpdate(update: StatusUpdate): void {
  _queue.push(update);
}

/** Return the current queue length (useful for UI indicators). */
export function pendingCount(): number {
  return _queue.length;
}

/** Return a snapshot of queued updates (read-only copy). */
export function peekQueue(): ReadonlyArray<StatusUpdate> {
  return [..._queue];
}

/**
 * Check whether the device currently has internet connectivity.
 * Uses expo-network; falls back to assuming online if the check fails.
 */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isInternetReachable ?? state.isConnected ?? true;
  } catch {
    // If we cannot determine state, assume online so we at least try.
    return true;
  }
}

/**
 * Attempt to flush the entire sync queue to the server.
 *
 * - If offline, the call is a no-op (updates stay queued).
 * - On success, the queue is cleared.
 * - On partial failure the queue is NOT cleared so it can be retried.
 *
 * Returns the number of updates successfully synced (0 if offline or error).
 */
export async function flushSyncQueue(): Promise<number> {
  if (_queue.length === 0) return 0;

  const online = await isOnline();
  if (!online) return 0;

  // Take a snapshot; we'll clear only after success.
  const batch = [..._queue];

  try {
    const result = await syncUpdates(batch);
    // Server acknowledged; clear the sent items from the queue.
    // If new items were enqueued during the request they'll remain.
    _queue = _queue.slice(batch.length);
    return result.accepted;
  } catch {
    // Network or server error -- keep everything queued for retry.
    return 0;
  }
}

/**
 * Convenience: try to flush on a regular interval.
 * Returns a cleanup function to stop the timer.
 */
export function startAutoSync(intervalMs: number = 30_000): () => void {
  const handle = setInterval(() => {
    flushSyncQueue().catch(() => {
      /* swallow -- next tick will retry */
    });
  }, intervalMs);

  return () => clearInterval(handle);
}

/** Clear the queue entirely (used during end-of-shift wipe). */
export function clearQueue(): void {
  _queue = [];
}
