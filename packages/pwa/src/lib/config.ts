function ensureSecureApiBase(base: string): string {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    base.startsWith("http://")
  ) {
    throw new Error("Refusing to use an insecure HTTP API from an HTTPS PWA");
  }

  return base.replace(/\/$/, "");
}

function shouldUseSameOriginPort(port: string): boolean {
  return port !== "3000" && port !== "5173";
}

export function resolvePwaApiBase(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    return ensureSecureApiBase(configured.endsWith("/api") ? configured : `${configured}/api`);
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:3001/api";
  }

  const url = new URL(window.location.href);
  if (shouldUseSameOriginPort(url.port)) {
    return ensureSecureApiBase(`${url.origin}/api`);
  }

  url.port = "3001";
  return ensureSecureApiBase(`${url.origin}/api`);
}

export function resolvePwaTileUrlTemplate(): string {
  const configured = import.meta.env.VITE_TILE_URL_TEMPLATE?.trim();
  if (configured) {
    return configured;
  }

  return `${resolvePwaApiBase().replace(/\/api$/, "")}/api/tiles/{z}/{x}/{y}.png`;
}
