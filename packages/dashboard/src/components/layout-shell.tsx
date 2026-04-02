"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { apiGet, getToken } from "@/lib/api";
import { LocaleProvider } from "@/lib/locale";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // Pages that don't require authentication
  const noAuth =
    pathname === "/setup" ||
    pathname === "/login" ||
    pathname === "/unlock";

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      if (noAuth) {
        if (!cancelled) setAuthChecked(true);
        return;
      }

      const token = getToken();
      if (token) {
        if (!cancelled) setAuthChecked(true);
        return;
      }

      // Fresh installs must reach unlock/setup before normal auth gating.
      const setupRes = await apiGet<any>("/api/setup/status");
      if (cancelled) return;

      if (setupRes.ok) {
        if (setupRes.data?.locked) {
          router.replace("/unlock");
          return;
        }
        if (!setupRes.data?.setupComplete) {
          router.replace("/setup");
          return;
        }
      }

      router.replace("/login");
    }

    setAuthChecked(false);
    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, [pathname, noAuth, router]);

  if (noAuth) {
    return <LocaleProvider><main>{children}</main></LocaleProvider>;
  }

  // Don't render protected content until auth is verified
  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <LocaleProvider>
      <Sidebar />
      <main className="pl-64">
        <div className="min-h-screen p-8">{children}</div>
      </main>
    </LocaleProvider>
  );
}
