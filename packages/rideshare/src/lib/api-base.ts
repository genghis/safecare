"use client";

function ensureSecureApiBase(base: string): string {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    base.startsWith("http://")
  ) {
    throw new Error("Refusing to use an insecure HTTP API from an HTTPS dashboard");
  }

  return base.replace(/\/$/, "");
}

function shouldUseSameOriginPort(port: string): boolean {
  return port !== "3002" && port !== "5173";
}

export function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return ensureSecureApiBase(configured);
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:3001";
  }

  const url = new URL(window.location.href);
  if (shouldUseSameOriginPort(url.port)) {
    return ensureSecureApiBase(url.origin);
  }

  url.port = "3001";
  return ensureSecureApiBase(url.origin);
}
