/**
 * React hooks for PWA-specific behaviour: online status, install prompt,
 * background sync, and session TTL auto-purge.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { startAutoSync, stopAutoSync } from "@/lib/sync";
import { checkExpiry, purgeAll } from "@/lib/db";

// ---------------------------------------------------------------------------
// useOnlineStatus
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the browser reports an active network connection.
 * Subscribes to the `online` / `offline` window events.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

// ---------------------------------------------------------------------------
// useInstallPrompt
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Captures the `beforeinstallprompt` event so we can show a custom
 * "Add to Home Screen" banner instead of (or in addition to) the browser's
 * default mini-infobar.
 */
export function useInstallPrompt(): {
  canInstall: boolean;
  promptInstall: () => void;
} {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the browser's default mini-infobar
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const promptInstall = useCallback(() => {
    if (!deferredPrompt.current) return;

    deferredPrompt.current.prompt();
    deferredPrompt.current.userChoice.then((choice) => {
      if (choice.outcome === "accepted") {
        setCanInstall(false);
      }
      deferredPrompt.current = null;
    });
  }, []);

  return { canInstall, promptInstall };
}

// ---------------------------------------------------------------------------
// useAutoSync
// ---------------------------------------------------------------------------

/**
 * Starts the background sync timer on mount, stops it on unmount.
 * Should be called once near the app root.
 */
export function useAutoSync(): void {
  useEffect(() => {
    startAutoSync();
    return () => {
      stopAutoSync();
    };
  }, []);
}

// ---------------------------------------------------------------------------
// usePurgeCheck
// ---------------------------------------------------------------------------

/**
 * On every visibility change (i.e. when the app comes back to the foreground),
 * checks whether the session TTL has expired. If expired, purges all local
 * data to ensure no PII lingers on the device past the allowed window.
 */
export function usePurgeCheck(): void {
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;

      try {
        const expired = await checkExpiry();
        if (expired) {
          await purgeAll();
          // Redirect to login — the app will naturally reset since there
          // is no longer a JWT or route data.
          window.location.replace("/");
        }
      } catch {
        // If the check itself fails, do not crash the app.
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Also run once on mount (the app may have been backgrounded for hours).
    handleVisibilityChange();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
