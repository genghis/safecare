import { resolveDashboardApiBase } from "@/lib/api-base";

interface ApiOptions extends RequestInit {
  token?: string;
}

interface ApiResponse<T> {
  data: T;
  ok: boolean;
  status: number;
  error?: string;
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  if (typeof window.sessionStorage?.getItem !== "function") return null;
  return window.sessionStorage;
}

function getLegacyStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  if (typeof window.localStorage?.getItem !== "function") return null;
  return window.localStorage;
}

export function getToken(): string | null {
  const sessionStorage = getSessionStorage();
  if (sessionStorage) {
    const token = sessionStorage.getItem("safecare_token");
    if (token) return token;
  }

  const legacyStorage = getLegacyStorage();
  if (!legacyStorage) return null;
  const legacyToken = legacyStorage.getItem("safecare_token");
  if (legacyToken && sessionStorage) {
    sessionStorage.setItem("safecare_token", legacyToken);
    legacyStorage.removeItem("safecare_token");
  }
  return legacyToken;
}

export function setToken(token: string): void {
  const sessionStorage = getSessionStorage();
  if (!sessionStorage) return;
  sessionStorage.setItem("safecare_token", token);
  getLegacyStorage()?.removeItem("safecare_token");
}

export function clearToken(): void {
  getSessionStorage()?.removeItem("safecare_token");
  getLegacyStorage()?.removeItem("safecare_token");
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<ApiResponse<T>> {
  const { token, headers: customHeaders, ...rest } = options;

  const authToken = token || getToken();

  const headers: Record<string, string> = {
    ...((customHeaders as Record<string, string>) || {}),
  };

  // Only set Content-Type when there's a body
  // Fastify rejects empty bodies with Content-Type: application/json
  if (rest.body) {
    headers["Content-Type"] = "application/json";
  }

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(`${resolveDashboardApiBase()}${path}`, {
      headers,
      ...rest,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      // Auto-redirect to login on auth failure
      if (response.status === 401 && typeof window !== "undefined") {
        clearToken();
        window.location.replace("/login");
      }
      return {
        data: data as T,
        ok: false,
        status: response.status,
        error: data?.message || data?.error || response.statusText,
      };
    }

    // Backend wraps responses in { success, data }. Unwrap if present.
    const unwrapped = data?.data !== undefined ? data.data : data;

    return {
      data: unwrapped as T,
      ok: true,
      status: response.status,
    };
  } catch (err) {
    return {
      data: null as T,
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

export const apiGet = <T = unknown>(path: string, opts?: ApiOptions) =>
  api<T>(path, { method: "GET", ...opts });

export const apiPost = <T = unknown>(
  path: string,
  body?: unknown,
  opts?: ApiOptions
) =>
  api<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });

export const apiPut = <T = unknown>(
  path: string,
  body?: unknown,
  opts?: ApiOptions
) =>
  api<T>(path, {
    method: "PUT",
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });

export const apiPatch = <T = unknown>(
  path: string,
  body?: unknown,
  opts?: ApiOptions
) =>
  api<T>(path, {
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });

export const apiDelete = <T = unknown>(path: string, opts?: ApiOptions) =>
  api<T>(path, { method: "DELETE", ...opts });
