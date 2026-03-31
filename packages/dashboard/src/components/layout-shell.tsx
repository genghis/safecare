"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { LocaleProvider } from "@/lib/locale";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("safecare_token");
}

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
    if (noAuth) {
      setAuthChecked(true);
      return;
    }
    // Protected pages: require a token
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setAuthChecked(true);
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
