/**
 * Locale context for the driver PWA.
 *
 * Provides a `useLocale()` hook that returns the current locale and a
 * translation function `t(key, vars?)`. The locale is determined by:
 * 1. Explicit override stored in localStorage
 * 2. Browser language (navigator.language)
 * 3. Fallback to English
 */

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { t as translate, type SupportedLocale, LOCALE_LABELS } from "../../../shared/src/i18n";

const LOCALE_STORAGE_KEY = "safecare_locale";

const SUPPORTED: SupportedLocale[] = ["en", "es", "ar", "so", "fr", "zh", "uk"];

function detectLocale(): SupportedLocale {
  // 1. Stored preference
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored as SupportedLocale)) {
      return stored as SupportedLocale;
    }
  } catch {}

  // 2. Browser language
  if (typeof navigator !== "undefined" && navigator.language) {
    const lang = navigator.language.split("-")[0].toLowerCase();
    if (SUPPORTED.includes(lang as SupportedLocale)) {
      return lang as SupportedLocale;
    }
  }

  // 3. Default
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

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {}
    // Set dir attribute for RTL languages
    if (typeof document !== "undefined") {
      document.documentElement.dir = newLocale === "ar" ? "rtl" : "ltr";
      document.documentElement.lang = newLocale;
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => translate(key, locale, vars),
    [locale],
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

export { SUPPORTED as SUPPORTED_LOCALES };
export type { SupportedLocale };
