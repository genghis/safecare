"use client";

/**
 * Locale context for the admin dashboard.
 *
 * Reads the org-level language from the settings API on mount.
 * Falls back to browser language, then English.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import { resolveDashboardApiBase } from "@/lib/api-base";

// Inline the types to avoid shared package import issues in Next.js
type SupportedLocale = "en" | "es" | "ar" | "so" | "fr" | "zh" | "uk";

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
  ar: "العربية",
  so: "Soomaali",
  fr: "Français",
  zh: "中文",
  uk: "Українська",
};

const SUPPORTED: SupportedLocale[] = ["en", "es", "ar", "so", "fr", "zh", "uk"];

// Inline translation function (mirrors shared/i18n.ts but avoids import issues)
// In production, this should import from @safecare/shared
let STRINGS: Record<string, Record<SupportedLocale, string>> = {};

// Load strings dynamically to avoid circular imports
async function loadStrings() {
  try {
    const mod = await import("@safecare/shared");
    // The shared module exports t() which accesses STRINGS internally
    return mod.t;
  } catch {
    return (key: string) => key;
  }
}

let tFunc: ((key: string, locale: SupportedLocale, vars?: Record<string, string>) => string) | null = null;

function detectLocale(): SupportedLocale {
  if (typeof window === "undefined") return "en";

  // Browser language
  const lang = navigator.language?.split("-")[0]?.toLowerCase();
  if (lang && SUPPORTED.includes(lang as SupportedLocale)) {
    return lang as SupportedLocale;
  }
  return "en";
}

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, vars?: Record<string, string>) => string;
  locales: typeof LOCALE_LABELS;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(detectLocale);
  const [loaded, setLoaded] = useState(false);

  // Load the translation function and org language on mount
  useEffect(() => {
    (async () => {
      // Load translations
      try {
        const mod = await import("@safecare/shared");
        tFunc = mod.t;
      } catch {}

      // Load org language from settings
      try {
        const response = await fetch(`${resolveDashboardApiBase()}/api/settings`);
        const data = await response.json().catch(() => null);

        if (response.ok && data?.data?.language) {
          const lang = data.data.language as SupportedLocale;
          if (SUPPORTED.includes(lang)) {
            setLocaleState(lang);
          }
        }
      } catch {}

      setLoaded(true);
    })();
  }, []);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    if (typeof document !== "undefined") {
      document.documentElement.dir = newLocale === "ar" ? "rtl" : "ltr";
      document.documentElement.lang = newLocale;
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => {
      if (tFunc) return tFunc(key, locale, vars);
      return key; // Fallback: show the key itself
    },
    // `loaded` is intentionally in the deps: tFunc is a module-level
    // variable that gets set inside the mount effect. Without `loaded`
    // here, consumers that don't independently re-render (e.g. the
    // sidebar nav) would capture the initial `t` where tFunc is null
    // and stay stuck on raw i18n keys forever.
    [locale, loaded],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, locales: LOCALE_LABELS }),
    [locale, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return ctx;
}

export { SUPPORTED as SUPPORTED_LOCALES, LOCALE_LABELS };
export type { SupportedLocale };
