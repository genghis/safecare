"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost } from "@/lib/api";

interface DispatchSession {
  id: string;
  date: string;
  status: "active" | "released" | "completed";
  strictness: StrictnessLevel;
  createdAt: string;
  releasedAt?: string;
}

interface DriverCheckIn {
  id: string;
  driverId: string;
  driverName: string;
  checkedInAt: string;
  vehicle: string;
  selected: boolean;
}

interface DeliveryStatus {
  id: string;
  recipientName: string;
  driverName: string;
  status: string;
  address: string;
  updatedAt: string;
}

type StrictnessLevel = "standard" | "high" | "maximum";

const STRICTNESS_OPTIONS: {
  value: StrictnessLevel;
  label: string;
  description: string;
}[] = [
  {
    value: "standard",
    label: "Standard",
    description: "GPS verification, photo optional",
  },
  {
    value: "high",
    label: "High",
    description: "GPS + photo required, recipient confirmation",
  },
  {
    value: "maximum",
    label: "Maximum",
    description: "GPS + photo + signature + recipient PIN",
  },
];

const AUTO_REFRESH_INTERVAL = 10_000;

export default function DispatchPage() {
  const [session, setSession] = useState<DispatchSession | null>(null);
  const [checkIns, setCheckIns] = useState<DriverCheckIn[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [strictness, setStrictness] = useState<StrictnessLevel>("standard");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSession = useCallback(async () => {
    const res = await apiGet<{
      session: DispatchSession | null;
      checkIns: DriverCheckIn[];
      deliveries: DeliveryStatus[];
    }>("/api/admin/dispatch/current");

    if (res.ok && res.data) {
      setSession(res.data.session);
      setCheckIns(
        (res.data.checkIns || []).map((c) => ({ ...c, selected: true }))
      );
      setDeliveries(res.data.deliveries || []);
      if (res.data.session?.strictness) {
        setStrictness(res.data.session.strictness);
      }
    }
    setLoading(false);
    setLastRefreshed(new Date());
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Auto-refresh every 10 seconds when a session is active
  useEffect(() => {
    if (session && session.status !== "completed") {
      refreshTimerRef.current = setInterval(() => {
        fetchSession();
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [session?.id, session?.status, fetchSession]);

  async function handleCreateSession() {
    setCreating(true);
    const res = await apiPost<{ session: DispatchSession }>(
      "/api/admin/dispatch/sessions",
      { date: sessionDate, strictness }
    );
    if (res.ok && res.data?.session) {
      setSession(res.data.session);
      setCheckIns([]);
      setDeliveries([]);
    }
    setCreating(false);
  }

  async function handleReleaseRoutes() {
    if (!session) return;
    setReleasing(true);

    const selectedDriverIds = checkIns
      .filter((c) => c.selected)
      .map((c) => c.driverId);

    const res = await apiPost<{ session: DispatchSession }>(
      `/api/admin/dispatch/sessions/${session.id}/release`,
      { driverIds: selectedDriverIds }
    );

    if (res.ok) {
      await fetchSession();
    }
    setReleasing(false);
  }

  async function handleStrictnessChange(level: StrictnessLevel) {
    setStrictness(level);
    if (session) {
      await apiPost(`/api/admin/dispatch/sessions/${session.id}/strictness`, {
        strictness: level,
      });
    }
  }

  function toggleDriver(id: string) {
    setCheckIns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  }

  function selectAll() {
    setCheckIns((prev) => prev.map((c) => ({ ...c, selected: true })));
  }

  function selectNone() {
    setCheckIns((prev) => prev.map((c) => ({ ...c, selected: false })));
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-8">Dispatch</h1>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading dispatch data...
        </div>
      </div>
    );
  }

  const selectedCount = checkIns.filter((c) => c.selected).length;

  // Delivery status breakdown counts
  const statusCounts = {
    pending: deliveries.filter((d) => d.status === "pending").length,
    in_transit: deliveries.filter((d) => d.status === "in_transit").length,
    delivered: deliveries.filter((d) => d.status === "delivered").length,
    acknowledged: deliveries.filter((d) => d.status === "acknowledged").length,
  };
  const totalDeliveries = deliveries.length;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispatch</h1>
          <p className="text-muted-foreground mt-1">
            Manage delivery sessions, driver check-ins, and route releases.
          </p>
        </div>
        {session && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
              aria-hidden="true"
            />
            Auto-refreshing &middot; Last updated{" "}
            {lastRefreshed.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Create New Session */}
      {!session && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Create New Session</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Date Picker */}
              <div className="space-y-2">
                <label
                  htmlFor="session-date"
                  className="text-sm font-medium text-foreground"
                >
                  Session Date
                </label>
                <Input
                  id="session-date"
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  className="max-w-[200px]"
                />
              </div>

              {/* Strictness Level */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Strictness Level
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {STRICTNESS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStrictness(opt.value)}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        strictness === opt.value
                          ? "border-primary bg-accent/50 ring-1 ring-primary"
                          : "border-border hover:bg-accent/30"
                      }`}
                    >
                      <p className="text-sm font-semibold">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {opt.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleCreateSession} disabled={creating}>
              {creating ? "Creating..." : "Create New Session"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Active Session */}
      {session && (
        <>
          {/* Session Info Bar */}
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-lg">Session Status</CardTitle>
              <StatusBadge status={session.status} />
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Session ID
                  </span>
                  <p className="text-sm font-mono">{session.id.slice(0, 8)}...</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Date</span>
                  <p className="text-sm">
                    {new Date(session.date || session.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Created</span>
                  <p className="text-sm">
                    {new Date(session.createdAt).toLocaleString()}
                  </p>
                </div>
                {session.releasedAt && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      Released
                    </span>
                    <p className="text-sm">
                      {new Date(session.releasedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Delivery Status Overview */}
          <div className="mb-6 grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-500">
                    {statusCounts.pending}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Pending</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-500">
                    {statusCounts.in_transit}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    In Transit
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-emerald-600">
                    {statusCounts.delivered}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Delivered
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-purple-600">
                    {statusCounts.acknowledged}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Acknowledged
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Strictness Level Selector */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Strictness Level</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {STRICTNESS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStrictnessChange(opt.value)}
                    className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                      strictness === opt.value
                        ? "border-primary bg-accent/50 ring-1 ring-primary"
                        : "border-border hover:bg-accent/30"
                    }`}
                  >
                    <p className="text-sm font-semibold">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {opt.description}
                    </p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Driver Check-ins */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Driver Check-ins
                    {checkIns.length > 0 && (
                      <Badge variant="success" className="ml-2">
                        {checkIns.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={selectAll}>
                      Select All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={selectNone}>
                      Clear
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {checkIns.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No drivers have checked in yet. Drivers check in via the
                    IVR/SMS system or mobile app.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {checkIns.map((checkIn) => (
                      <div
                        key={checkIn.id}
                        className={`flex items-center justify-between rounded-md border p-3 cursor-pointer transition-colors ${
                          checkIn.selected
                            ? "border-primary bg-accent/50"
                            : "border-border hover:bg-accent/30"
                        }`}
                        onClick={() => toggleDriver(checkIn.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-4 w-4 rounded border flex items-center justify-center ${
                              checkIn.selected
                                ? "bg-primary border-primary"
                                : "border-muted-foreground"
                            }`}
                          >
                            {checkIn.selected && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              {checkIn.driverName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {checkIn.vehicle || "No vehicle info"}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(checkIn.checkedInAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
              {checkIns.length > 0 && session.status === "active" && (
                <CardFooter>
                  <Button
                    onClick={handleReleaseRoutes}
                    disabled={releasing || selectedCount === 0}
                    className="w-full"
                  >
                    {releasing
                      ? "Releasing Routes..."
                      : `Approve & Release Routes (${selectedCount} driver${
                          selectedCount !== 1 ? "s" : ""
                        })`}
                  </Button>
                </CardFooter>
              )}
            </Card>

            {/* Delivery Progress */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Delivery Progress</CardTitle>
                  {totalDeliveries > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {statusCounts.delivered + statusCounts.acknowledged}/
                      {totalDeliveries}
                    </span>
                  )}
                </div>
                {totalDeliveries > 0 && (
                  <div className="w-full bg-muted rounded-full h-2 mt-2">
                    <div
                      className="bg-emerald-600 h-2 rounded-full transition-all"
                      style={{
                        width: `${
                          totalDeliveries > 0
                            ? ((statusCounts.delivered +
                                statusCounts.acknowledged) /
                                totalDeliveries) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {deliveries.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {session.status === "active"
                      ? "Deliveries will appear here after routes are released."
                      : "No deliveries in this session."}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {deliveries.map((delivery) => (
                      <div
                        key={delivery.id}
                        className="flex items-center justify-between rounded-md border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {delivery.recipientName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {delivery.address}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Driver: {delivery.driverName}
                          </p>
                        </div>
                        <div className="ml-3 flex-shrink-0">
                          <StatusBadge status={delivery.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
