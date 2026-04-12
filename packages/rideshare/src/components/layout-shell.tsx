"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { apiGet, getToken } from "@/lib/api";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const noAuth = pathname === "/login";

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

      router.replace("/login");
    }

    setAuthChecked(false);
    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, [pathname, noAuth, router]);

  if (noAuth) {
    return <main>{children}</main>;
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <main className="pl-64">
        <div className="min-h-screen p-8">{children}</div>
      </main>
    </>
  );
}
