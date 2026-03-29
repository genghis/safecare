const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface ApiOptions extends RequestInit {
  token?: string;
}

interface ApiResponse<T> {
  data: T;
  ok: boolean;
  status: number;
  error?: string;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("safecare_token");
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("safecare_token", token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("safecare_token");
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<ApiResponse<T>> {
  const { token, headers: customHeaders, ...rest } = options;

  const authToken = token || getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers,
      ...rest,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
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
