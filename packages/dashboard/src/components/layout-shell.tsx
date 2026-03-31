"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Setup and login pages render without sidebar
  const noSidebar = pathname === "/setup" || pathname === "/login" || pathname === "/unlock";

  if (noSidebar) {
    return <main>{children}</main>;
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
