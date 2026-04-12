"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";

interface Shift {
  id: string;
  date: string;
  pickupTime: string;
  serviceType: string;
  label: string | null;
  pickupNeighborhood: string | null;
  dropoffNeighborhood: string | null;
  requiresCleanVehicle: boolean;
  passengerCount: number;
  carSeatRequired: boolean;
  status: string;
  driverId: string | null;
  notes: string | null;
}

const statusColors: Record<string, "default" | "warning" | "success" | "destructive" | "secondary"> = {
  open: "default",
  claimed: "warning",
  confirmed: "success",
  in_progress: "secondary",
  completed: "success",
  cancelled: "destructive",
  no_show: "destructive",
};

export default function ShiftBoardPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [statusFilter, setStatusFilter] = useState("");

  const fetchShifts = async () => {
    setLoading(true);
    let url = `/api/rides/shifts?from=${dateFrom}&to=${dateTo}`;
    if (statusFilter) url += `&status=${statusFilter}`;
    const res = await apiGet<Shift[]>(url);
    if (res.ok) setShifts(res.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchShifts();
  }, [dateFrom, dateTo, statusFilter]);

  const handleAction = async (shiftId: string, action: string) => {
    await apiPost(`/api/rides/shifts/${shiftId}/${action}`, action === "cancel" ? { reason: "Cancelled by coordinator" } : undefined);
    fetchShifts();
  };

  // Group shifts by date
  const grouped = shifts.reduce<Record<string, Shift[]>>((acc, shift) => {
    const key = shift.date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(shift);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Shift Board</h1>
        <p className="text-muted-foreground mt-1">
          All scheduled rides and transit escorts. Confirm claims, manage assignments.
        </p>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="claimed">Claimed</option>
          <option value="confirmed">Confirmed</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No Show</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No shifts found for the selected date range and filters.
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dayShifts]) => (
            <div key={date} className="mb-6">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </h3>
              <div className="space-y-2">
                {dayShifts
                  .sort((a, b) => a.pickupTime.localeCompare(b.pickupTime))
                  .map((shift) => (
                    <Card key={shift.id}>
                      <CardContent className="py-3 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="text-lg font-mono font-semibold w-16">
                            {shift.pickupTime}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${shift.serviceType === "transit_escort" ? "bg-purple-500/15 text-purple-700 dark:text-purple-400" : "bg-blue-500/15 text-blue-700 dark:text-blue-400"}`}>
                                {shift.serviceType === "transit_escort" ? "Escort" : "Ride"}
                              </span>
                              <span className="font-medium">
                                {shift.label ?? `${shift.pickupNeighborhood ?? "?"} to ${shift.dropoffNeighborhood ?? "?"}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {shift.requiresCleanVehicle && (
                                <span className="text-green-600 dark:text-green-400 font-medium">Clean vehicle</span>
                              )}
                              {shift.passengerCount > 1 && <span>{shift.passengerCount} pax</span>}
                              {shift.carSeatRequired && <span>Car seat</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={statusColors[shift.status] ?? "default"}>
                            {shift.status.replace("_", " ")}
                          </Badge>
                          {shift.status === "claimed" && (
                            <>
                              <Button size="sm" onClick={() => handleAction(shift.id, "confirm")}>Confirm</Button>
                              <Button size="sm" variant="outline" onClick={() => handleAction(shift.id, "reject")}>Reject</Button>
                            </>
                          )}
                          {shift.status === "open" && (
                            <Button size="sm" variant="destructive" onClick={() => handleAction(shift.id, "cancel")}>Cancel</Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>
          ))
      )}
    </div>
  );
}
