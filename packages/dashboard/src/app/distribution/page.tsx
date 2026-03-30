"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiPost } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DistributionDriver {
  id: string;
  name: string;
  team: string;
  vehicleSize: string;
  maxDeliveries: number;
  assignedDeliveries: AssignedDelivery[];
  loadPercent?: number;
}

interface AssignedDelivery {
  id: string;
  recipientName: string;
  address: string;
  shortAddress: string;
}

interface UnassignedDelivery {
  id: string;
  recipientName: string;
  address: string;
  zone: string;
  zoneColor: string;
  notes: string;
  warning?: string;
}

interface DistributionWarning {
  type: string;
  message: string;
}

interface DistributionSession {
  id: string;
  date: string;
  status: string;
}

interface DistributionState {
  drivers: DistributionDriver[];
  unassigned: UnassignedDelivery[];
  warnings: DistributionWarning[];
  sessions: DistributionSession[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VEHICLE_SIZES: Record<string, { label: string; defaultMaxDeliveries: number }> = {
  compact: { label: "Compact / Hatchback", defaultMaxDeliveries: 2 },
  sedan: { label: "Sedan", defaultMaxDeliveries: 3 },
  suv: { label: "SUV / Crossover", defaultMaxDeliveries: 5 },
  minivan: { label: "Minivan", defaultMaxDeliveries: 7 },
  truck: { label: "Pickup / Van", defaultMaxDeliveries: 10 },
};

const DAYS_OF_WEEK = [
  { value: "mon", label: "Monday", short: "Mon" },
  { value: "tue", label: "Tuesday", short: "Tue" },
  { value: "wed", label: "Wednesday", short: "Wed" },
  { value: "thu", label: "Thursday", short: "Thu" },
  { value: "fri", label: "Friday", short: "Fri" },
  { value: "sat", label: "Saturday", short: "Sat" },
  { value: "sun", label: "Sunday", short: "Sun" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVehicleLabel(size: string): string {
  const v = VEHICLE_SIZES[size];
  return v ? `${v.label} - ${v.defaultMaxDeliveries} max` : size;
}

function loadPercent(assigned: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((assigned / max) * 100);
}

function loadColor(pct: number): string {
  if (pct > 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DistributionPage() {
  const [drivers, setDriversRaw] = useState<DistributionDriver[]>([]);

  // Normalize API response fields to match frontend expectations
  function normalizeDrivers(raw: any[]): DistributionDriver[] {
    return raw.map((d: any) => ({
      ...d,
      id: d.id || d.driverId,
      name: d.name || d.driverName,
      team: d.team || '',
      assignedDeliveries: (d.assignedDeliveries || d.deliveries || []).map((del: any) => ({
        ...del,
        id: del.id || del.deliveryId,
        shortAddress: del.shortAddress || (del.address ? del.address.split(',')[0] : ''),
      })),
    }));
  }

  function setDrivers(raw: DistributionDriver[] | ((prev: DistributionDriver[]) => DistributionDriver[])) {
    if (typeof raw === 'function') {
      setDriversRaw(raw);
    } else {
      setDriversRaw(normalizeDrivers(raw));
    }
  }
  const [unassigned, setUnassigned] = useState<UnassignedDelivery[]>([]);
  const [warnings, setWarnings] = useState<DistributionWarning[]>([]);
  const [sessions, setSessions] = useState<DistributionSession[]>([]);

  const [selectedSession, setSelectedSession] = useState("");
  const [selectedDay, setSelectedDay] = useState<string>("mon");
  const [sortByLoad, setSortByLoad] = useState(false);

  const [loading, setLoading] = useState(true);
  const [distributing, setDistributing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  // Fetch distribution state
  const fetchState = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedSession) params.set("sessionId", selectedSession);
    if (selectedDay) params.set("day", selectedDay);

    const res = await apiGet<DistributionState>(
      `/api/distribution?${params.toString()}`
    );

    if (res.ok && res.data) {
      setDrivers(res.data.drivers || []);
      setUnassigned(res.data.unassigned || []);
      setWarnings(res.data.warnings || []);
      if (res.data.sessions) {
        setSessions(res.data.sessions);
        // Auto-select first session if none selected
        if (!selectedSession && res.data.sessions.length > 0) {
          setSelectedSession(res.data.sessions[0].id);
        }
      }
    }
    setLoading(false);
  }, [selectedSession, selectedDay]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Sort drivers by load percentage if toggled
  const sortedDrivers = sortByLoad
    ? [...drivers].sort((a, b) => {
        const pctA = loadPercent((a.assignedDeliveries || []).length, a.maxDeliveries || 0);
        const pctB = loadPercent((b.assignedDeliveries || []).length, b.maxDeliveries || 0);
        return pctB - pctA;
      })
    : drivers;

  // Stats
  const totalAssigned = drivers.reduce(
    (sum, d) => sum + (d.assignedDeliveries || []).length,
    0
  );
  const totalUnassigned = unassigned.length;
  const totalWarnings = warnings.length;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function handleAutoDistribute() {
    setDistributing(true);
    const res = await apiPost<DistributionState>("/api/distribution/propose", {
      sessionId: selectedSession,
      dayOfWeek: selectedDay,
    });
    if (res.ok && res.data) {
      setDrivers(res.data.drivers || []);
      setUnassigned(res.data.unassigned || []);
      setWarnings(res.data.warnings || []);
    } else {
      alert(res.error || "Auto-distribute failed. Make sure a session is selected.");
    }
    setDistributing(false);
  }

  async function handleMoveDelivery(deliveryId: string, toDriverId: string, fromDriverId?: string) {
    const res = await apiPost<DistributionState>("/api/distribution/move", {
      sessionId: selectedSession,
      deliveryId,
      fromDriverId: fromDriverId || "",
      toDriverId,
    });
    if (res.ok && res.data) {
      setDrivers(res.data.drivers || []);
      setUnassigned(res.data.unassigned || []);
      setWarnings(res.data.warnings || []);
    }
  }

  async function handleAdjustCapacity(driverId: string, delta: number) {
    const driver = drivers.find((d) => d.id === driverId);
    if (!driver) return;
    const newMax = Math.max(1, driver.maxDeliveries + delta);

    const res = await apiPost<DistributionState>(
      "/api/distribution/adjust-capacity",
      {
        driverId,
        maxDeliveries: newMax,
        sessionId: selectedSession,
      }
    );
    if (res.ok && res.data) {
      setDrivers(res.data.drivers || []);
      setWarnings(res.data.warnings || []);
    } else {
      // Optimistic update
      setDrivers((prev) =>
        prev.map((d) =>
          d.id === driverId ? { ...d, maxDeliveries: newMax } : d
        )
      );
    }
  }

  async function handleRemoveDriver(driverId: string) {
    const res = await apiPost<DistributionState>(
      "/api/distribution/remove-driver",
      {
        driverId,
        sessionId: selectedSession,
      }
    );
    if (res.ok && res.data) {
      setDrivers(res.data.drivers || []);
      setUnassigned(res.data.unassigned || []);
      setWarnings(res.data.warnings || []);
    }
    setRemoveConfirmId(null);
  }

  async function handleRemoveDelivery(driverId: string, deliveryId: string) {
    // Move delivery back to unassigned pool
    const res = await apiPost<DistributionState>("/api/distribution/move", {
      sessionId: selectedSession,
      deliveryId,
      fromDriverId: driverId,
      toDriverId: driverId, // keeps in pool, backend handles unassign
    });
    if (res.ok && res.data) {
      setDrivers(res.data.drivers || []);
      setUnassigned(res.data.unassigned || []);
      setWarnings(res.data.warnings || []);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    const assignments = drivers.map((d) => ({
      driverId: d.id,
      deliveryIds: (d.assignedDeliveries || []).map((del) => del.id),
    })).filter((a) => a.deliveryIds.length > 0);

    const res = await apiPost("/api/distribution/confirm", {
      sessionId: selectedSession,
      assignments,
    });
    if (res.ok) {
      window.location.href = "/dispatch";
    } else {
      alert(res.error || "Failed to confirm assignments.");
    }
    setConfirming(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-8">
          Distribution Planner
        </h1>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading distribution data...
        </div>
      </div>
    );
  }

  const hasData = drivers.length > 0 || unassigned.length > 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Distribution Planner
        </h1>
        <p className="text-muted-foreground mt-1">
          Assign deliveries to drivers by zone and capacity.
        </p>
      </div>

      <div className="flex gap-6 min-h-[calc(100vh-12rem)]">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT PANEL: Driver cards */}
        {/* ----------------------------------------------------------------- */}
        <div className="w-[40%] flex flex-col gap-4 overflow-y-auto pr-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Drivers{" "}
              <span className="text-muted-foreground font-normal text-sm">
                ({drivers.length})
              </span>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSortByLoad((v) => !v)}
            >
              {sortByLoad ? "Default Order" : "Sort by Load"}
            </Button>
          </div>

          {drivers.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No drivers available. Run Auto-Distribute to get started.
              </CardContent>
            </Card>
          )}

          {sortedDrivers.map((driver) => {
            const count = (driver.assignedDeliveries || []).length;
            const max = driver.maxDeliveries || 0;
            const pct = loadPercent(count, max);

            return (
              <Card key={driver.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">
                        {driver.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {driver.team}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {getVehicleLabel(driver.vehicleSize)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Capacity bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>
                        {count}/{max} deliveries
                      </span>
                      <span className="text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`${loadColor(pct)} h-2 rounded-full transition-all`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Capacity stepper */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Max deliveries:
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleAdjustCapacity(driver.id, -1)}
                        disabled={max <= 1}
                      >
                        -
                      </Button>
                      <span className="text-sm font-medium w-8 text-center">
                        {max}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleAdjustCapacity(driver.id, 1)}
                      >
                        +
                      </Button>
                    </div>
                  </div>

                  {/* Assigned delivery chips */}
                  {count > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(driver.assignedDeliveries || []).map((del) => (
                        <span
                          key={del.id}
                          className="inline-flex items-center gap-1 rounded-md border bg-accent/50 px-2 py-0.5 text-xs"
                        >
                          {del.shortAddress || del.address.split(",")[0]}
                          <button
                            className="ml-0.5 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              handleRemoveDelivery(driver.id, del.id)
                            }
                            title="Remove delivery"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  {removeConfirmId === driver.id ? (
                    <div className="flex items-center gap-2 w-full">
                      <span className="text-xs text-destructive">
                        Remove this driver?
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRemoveDriver(driver.id)}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoveConfirmId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRemoveConfirmId(driver.id)}
                    >
                      Remove Driver
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* RIGHT PANEL: Unassigned pool + controls */}
        {/* ----------------------------------------------------------------- */}
        <div className="w-[60%] flex flex-col gap-4">
          {/* Controls */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Session selector */}
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium whitespace-nowrap">
                  Session:
                </label>
                <select
                  value={selectedSession}
                  onChange={(e) => setSelectedSession(e.target.value)}
                  className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select a session...</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.date).toLocaleDateString()} — {s.status}
                    </option>
                  ))}
                </select>
              </div>

              {/* Day selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Day of Week:</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <button
                      key={day.value}
                      onClick={() => setSelectedDay(day.value)}
                      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                        selectedDay === day.value
                          ? "border-primary bg-accent/50 ring-1 ring-primary"
                          : "border-border hover:bg-accent/30"
                      }`}
                    >
                      {day.short}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions row */}
              <div className="flex items-center justify-between">
                <Button
                  size="lg"
                  onClick={handleAutoDistribute}
                  disabled={distributing || !selectedSession}
                  className="px-8"
                >
                  {distributing ? "Distributing..." : "Auto-Distribute"}
                </Button>

                <span className="text-sm text-muted-foreground">
                  {totalAssigned} assigned, {totalUnassigned} unassigned,{" "}
                  {totalWarnings} warning{totalWarnings !== 1 ? "s" : ""}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Empty state */}
          {!hasData && (
            <Card>
              <CardContent className="py-16 text-center">
                <p className="text-muted-foreground">
                  Select a session and day, then click Auto-Distribute to get
                  started.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Unassigned deliveries */}
          {unassigned.length > 0 && (
            <Card className="flex-1 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Unassigned Deliveries
                  <Badge variant="warning" className="ml-2">
                    {unassigned.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto max-h-[400px]">
                <div className="space-y-2">
                  {unassigned.map((delivery) => (
                    <div
                      key={delivery.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">
                            {delivery.recipientName}
                          </p>
                          {delivery.zone && (
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={
                                delivery.zoneColor
                                  ? {
                                      borderColor: delivery.zoneColor,
                                      color: delivery.zoneColor,
                                    }
                                  : undefined
                              }
                            >
                              {delivery.zone}
                            </Badge>
                          )}
                          {delivery.warning && (
                            <Badge variant="warning" className="text-xs">
                              {delivery.warning}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {delivery.address}
                        </p>
                        {delivery.notes && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {delivery.notes.length > 60
                              ? delivery.notes.slice(0, 60) + "..."
                              : delivery.notes}
                          </p>
                        )}
                      </div>
                      <div className="ml-3 flex-shrink-0">
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleMoveDelivery(delivery.id, e.target.value);
                              e.target.value = "";
                            }
                          }}
                          className="h-9 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="">Assign to...</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.assignedDeliveries.length}/
                              {d.maxDeliveries})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Warnings panel */}
          {warnings.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Warnings
                  <Badge variant="destructive" className="ml-2">
                    {warnings.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {warnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 text-amber-600 flex-shrink-0"
                      >
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                      </svg>
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        {typeof w === "string" ? w : w.message}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Confirm button */}
          {hasData && (
            <div className="flex justify-end pt-2">
              <Button
                size="lg"
                onClick={handleConfirm}
                disabled={confirming || unassigned.length > 0}
                className="px-8"
              >
                {confirming
                  ? "Confirming..."
                  : unassigned.length > 0
                  ? `Confirm & Assign (${unassigned.length} unassigned remaining)`
                  : "Confirm & Assign"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
