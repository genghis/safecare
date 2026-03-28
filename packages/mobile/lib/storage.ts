import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------------
// Secure token storage (JWT / session key)
// ---------------------------------------------------------------------------

const TOKEN_KEY = "safecare_jwt";

/** Persist the JWT to secure storage. */
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** Retrieve the stored JWT (or null if not set). */
export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

/** Remove the stored JWT. */
export async function removeToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// In-memory route data store
// ---------------------------------------------------------------------------
// Phase 1: simple in-memory cache. Survives only within the current app
// session. Phase 2 will replace this with SQLCipher-backed encrypted storage.

type Delivery = {
  id: string;
  sequence: number;
  address: string;
  notes: string;
  status: "pending" | "in_transit" | "delivered";
};

let _routeData: Delivery[] | null = null;

/** Save route data to the in-memory store. */
export function setRouteData(deliveries: Delivery[]): void {
  _routeData = deliveries;
}

/** Retrieve cached route data (or null if none loaded). */
export function getRouteData(): Delivery[] | null {
  return _routeData;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Clear ALL local data: JWT from secure store and in-memory route data.
 * Called at end-of-shift to enforce data minimisation.
 */
export async function clearAll(): Promise<void> {
  await removeToken();
  _routeData = null;
}
