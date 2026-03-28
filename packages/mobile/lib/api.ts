import { getToken } from "./storage";

/**
 * MADS API client for driver-facing mobile app.
 * Base URL is resolved from environment or defaults to localhost for dev.
 */

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip JWT auth header (used for login endpoints). */
  noAuth?: boolean;
};

async function request<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, noAuth = false } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (!noAuth) {
    const token = await getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API ${method} ${path} failed (${response.status}): ${errorBody}`
    );
  }

  // Some endpoints may return 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Request an OTP code for the given phone + PIN combination. */
export function requestOtp(phone: string, pin: string) {
  return request<{ ok: boolean }>("/auth/otp", {
    method: "POST",
    body: { phone, pin },
    noAuth: true,
  });
}

/** Verify OTP and receive a JWT. */
export function verifyOtp(phone: string, code: string) {
  return request<{ token: string }>("/auth/verify", {
    method: "POST",
    body: { phone, code },
    noAuth: true,
  });
}

// ---------------------------------------------------------------------------
// Session / Route lifecycle
// ---------------------------------------------------------------------------

/** Driver checks in as ready for routes. */
export function checkIn() {
  return request<{ sessionId: string }>("/driver/check-in", {
    method: "POST",
  });
}

/** Poll whether routes have been released for the current session. */
export function pollStatus() {
  return request<{ routesReady: boolean; sessionId: string }>(
    "/driver/status"
  );
}

/** Download the assigned route (list of deliveries). */
export function downloadRoute() {
  return request<{
    deliveries: Array<{
      id: string;
      sequence: number;
      address: string;
      notes: string;
      status: string;
    }>;
  }>("/driver/route");
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type StatusUpdate = {
  deliveryId: string;
  status: string;
  timestamp: string;
};

/** Push batched delivery status updates to the server. */
export function syncUpdates(updates: StatusUpdate[]) {
  return request<{ accepted: number }>("/driver/sync", {
    method: "POST",
    body: { updates },
  });
}

/** Confirm that all local data has been purged (end-of-shift). */
export function confirmPurge() {
  return request<{ ok: boolean }>("/driver/purge", {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Driver Profile
// ---------------------------------------------------------------------------

/** Fetch current driver profile and availability. */
export function getProfile() {
  return request<any>("/driver/profile");
}

/** Update driver profile (vehicle, availability, zones). */
export function updateProfile(data: {
  vehicleSize: string;
  maxDeliveries: number;
  availability: Record<string, { start: string; end: string }>;
  selectedZones: string[];
}) {
  return request<any>("/driver/profile", {
    method: "PUT",
    body: data,
  });
}

/** Fetch available delivery zones. */
export function getZones() {
  return request<{ zones: Array<{ id: string; name: string; color: string }> }>(
    "/zones"
  );
}
