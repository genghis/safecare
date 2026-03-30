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

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

const BASE_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

// ---------------------------------------------------------------------------
// In-memory JWT (not localStorage — less surface for XSS exfiltration)
// ---------------------------------------------------------------------------

let jwt: string | null = null;

export function setToken(token: string): void {
  jwt = token;
  // Fallback: store in localStorage when crypto isn't ready
  try { localStorage.setItem('safecare_driver_token', token); } catch {}
}

export function getToken(): string | null {
  if (jwt) return jwt;
  // Restore from localStorage
  try {
    const stored = localStorage.getItem('safecare_driver_token');
    if (stored) { jwt = stored; return stored; }
  } catch {}
  return null;
}

export function clearToken(): void {
  jwt = null;
  try { localStorage.removeItem('safecare_driver_token'); } catch {}
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

  const response = await fetch(`${BASE_URL}${path}`, {
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
  }>("/driver/status");
}

export function downloadRoute(token: string) {
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
    routeGeometry?: { type: "LineString"; coordinates: [number, number][] };
    tileBounds?: { south: number; west: number; north: number; east: number };
    tileUrls?: string[];
    routeDistance?: number;
    routeDuration?: number;
  }>("/driver/download", {
    method: "POST",
    body: { token },
  });
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
