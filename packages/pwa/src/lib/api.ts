/**
 * API client for the PWA driver app.
 *
 * Matches the endpoints used by the native mobile app
 * (packages/mobile/lib/api.ts) but stores the JWT in memory rather than
 * AsyncStorage. An encrypted copy is persisted in IndexedDB so the token
 * survives page refreshes without being exposed in localStorage.
 */

import { storeEncrypted, readEncrypted } from "@/lib/db";
import { getCurrentKey } from "@/lib/crypto";
import { resolvePwaApiBase } from "@/lib/config";

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

function getStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  if (typeof localStorage.getItem !== "function") return null;
  return localStorage;
}

// ---------------------------------------------------------------------------
// In-memory JWT (not localStorage — less surface for XSS exfiltration)
// ---------------------------------------------------------------------------

let jwt: string | null = null;

export function setToken(token: string): void {
  jwt = token;
  // NOTE: JWT is stored in memory only. Once the encryption key is available
  // (after route download), the JWT is persisted to encrypted IndexedDB.
  // localStorage is NOT used — it is readable by forensic tools on a seized device.
}

export function getToken(): string | null {
  if (jwt) return jwt;
  // Migration fallback: read from localStorage if it was stored there previously.
  // New sessions never write to localStorage. This path will be removed in a future release.
  try {
    const stored = getStorage()?.getItem('safecare_driver_token');
    if (stored) {
      jwt = stored;
      // Clean it up immediately — don't leave it in plaintext storage
      getStorage()?.removeItem('safecare_driver_token');
      return stored;
    }
  } catch {}
  return null;
}

export function clearToken(): void {
  jwt = null;
  try { getStorage()?.removeItem('safecare_driver_token'); } catch {}
  try { getStorage()?.removeItem('safecare_install_dismissed'); } catch {}
}

/**
 * Persist the JWT to encrypted IndexedDB so it survives hard refreshes.
 * Only works when a crypto key is available.
 */
export async function persistToken(token: string): Promise<void> {
  if (getCurrentKey()) {
    await storeEncrypted("session", "jwt", token);
  }
}

/**
 * Restore the JWT from encrypted IndexedDB into memory.
 * Returns the token if found, or null.
 */
export async function restoreToken(): Promise<string | null> {
  if (!getCurrentKey()) return null;
  try {
    const token = (await readEncrypted("session", "jwt")) as string | null;
    if (token) {
      jwt = token;
    }
    return token;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  noAuth?: boolean;
};

async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, noAuth = false } = options;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // Only set Content-Type when we have a body to send
  // Fastify rejects empty bodies with Content-Type: application/json
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (!noAuth && jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  const response = await fetch(`${resolvePwaApiBase()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API ${method} ${path} failed (${response.status}): ${errorBody}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json();
  // Backend wraps responses in { success, data }. Unwrap if present.
  const unwrapped = json?.data !== undefined ? json.data : json;
  return unwrapped as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function requestOtp(phone: string) {
  return request<{ sent: boolean; otp?: string }>("/auth/driver/request-otp", {
    method: "POST",
    body: { phone },
    noAuth: true,
  });
}

export function verifyOtp(phone: string, otp: string) {
  return request<{ token: string; driverId: string }>("/auth/driver/verify-otp", {
    method: "POST",
    body: { phone, otp },
    noAuth: true,
  });
}

// ---------------------------------------------------------------------------
// Session / Route lifecycle
// ---------------------------------------------------------------------------

export function checkIn() {
  return request<{ sessionId: string }>("/driver/check-in", {
    method: "POST",
  });
}

export function pollStatus() {
  return request<{
    sessionActive: boolean;
    sessionId?: string;
    checkedIn: boolean;
    routeReleased: boolean;
    routeDownloaded: boolean;
    downloadToken?: string;
    revoked?: boolean;
  }>("/driver/status");
}

export function downloadRoute(token: string, driverLat?: number, driverLng?: number) {
  return request<{
    sessionId: string;
    driverId: string;
    stops: Array<{
      deliveryId: string;
      address: string;
      lat: number;
      lng: number;
      notes: string;
      recipientName: string;
      sequence: number;
    }>;
    expiresAt: string;
    sessionKey?: string;
    routeGeometry?: { type: "LineString"; coordinates: [number, number][] };
    tileBounds?: { south: number; west: number; north: number; east: number };
    tileUrls?: string[];
    routeDistance?: number;
    routeDuration?: number;
  }>("/driver/download", {
    method: "POST",
    body: { token, driverLat, driverLng },
  });
}

/**
 * Re-issue the session encryption key from the server.
 * Used to recover after tab close / browser kill when the driver is online.
 */
export function getSessionKey() {
  return request<{ sessionKey: string }>("/driver/session-key");
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export function syncUpdates(
  updates: Array<{ deliveryId: string; status: string; timestamp: string }>,
) {
  return request<{ synced: number }>("/driver/sync", {
    method: "POST",
    body: { updates },
  });
}

export function confirmPurge(sessionId: string) {
  return request<{ success: boolean }>("/driver/purge-confirm", {
    method: "POST",
    body: { sessionId },
  });
}

// ---------------------------------------------------------------------------
// Driver Profile
// ---------------------------------------------------------------------------

export function getProfile() {
  return request<Record<string, unknown>>("/driver/profile");
}

export function updateProfile(data: Record<string, unknown>) {
  return request<Record<string, unknown>>("/driver/profile", {
    method: "PUT",
    body: data,
  });
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export function getZones() {
  return request<{
    zones: Array<{ id: string; name: string; color: string }>;
  }>("/zones");
}
