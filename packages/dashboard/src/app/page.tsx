"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";

interface DashboardStats {
  totalRecipients: number;
  activeDrivers: number;
  todaysDeliveries: number;
  pendingOrders: number;
}

interface OrgSettings {
  orgName: string;
  serviceArea: { lat: number; lng: number; zoom: number; label: string };
}

interface ProvisionStatus {
  status: "not_started" | "downloading" | "importing" | "ready" | "error";
}

const defaultStats: DashboardStats = {
  totalRecipients: 0,
  activeDrivers: 0,
  todaysDeliveries: 0,
  pendingOrders: 0,
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [loading, setLoading] = useState(true);
  const [showSetupBanner, setShowSetupBanner] = useState(false);
  const [show2faBanner, setShow2faBanner] = useState(false);

  useEffect(() => {
    async function fetchData() {
      // Check if system is locked or initial setup is needed
      const setupRes = await apiGet<any>("/api/setup/status");
      if (setupRes.ok) {
        if (setupRes.data?.locked) {
          router.push("/unlock");
          return;
        }
        if (!setupRes.data?.setupComplete) {
          router.push("/setup");
          return;
        }
      }

      const statsRes = await apiGet<DashboardStats>("/api/dashboard/stats");
      if (statsRes.ok) {
        setStats(statsRes.data);
      }

      // Check 2FA status to show nudge
      const totpRes = await apiGet<{ enabled: boolean }>("/api/auth/admin/totp/status");
      if (totpRes.ok && !totpRes.data?.enabled) {
        setShow2faBanner(true);
      }

      setShowSetupBanner(false);
      setLoading(false);
    }
    fetchData();
  }, []);

  const cards = [
    {
      title: "Total Recipients",
      value: stats.totalRecipients,
      description: "Registered recipients in the system",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      title: "Active Drivers",
      value: stats.activeDrivers,
      description: "Drivers currently checked in",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.684-.948V8a1 1 0 0 1 1-1h2l3 3v5a1 1 0 0 1-1 1h-1" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" />
        </svg>
      ),
    },
    {
      title: "Today's Deliveries",
      value: stats.todaysDeliveries,
      description: "Deliveries scheduled for today",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
          <path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
        </svg>
      ),
    },
    {
      title: "Pending Orders",
      value: stats.pendingOrders,
      description: "Orders awaiting assignment",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of today&apos;s mutual aid delivery operations.
        </p>
      </div>

      {showSetupBanner && (
        <Card className="mb-6 border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <h3 className="font-semibold">Welcome to SafeCare</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Set up your service area in Settings to enable address search,
              maps, and offline routing.
            </p>
            <Button className="mt-3" onClick={() => router.push("/settings")}>
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      )}

      {show2faBanner && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3">
          <p className="text-sm">
            Protect your account with two-factor authentication.{" "}
            <button
              onClick={() => router.push("/settings")}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Set it up in Settings.
            </button>
          </p>
          <button
            onClick={() => setShow2faBanner(false)}
            className="ml-4 text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Dismiss"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              {card.icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? (
                  <span className="inline-block h-8 w-16 animate-pulse rounded bg-muted" />
                ) : (
                  card.value
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
