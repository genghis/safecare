"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { DAYS_OF_WEEK } from "@safecare/shared";

interface Schedule {
  id: string;
  recipientId: string;
  pickupLocationId: string;
  dropoffLocationId: string;
  daysOfWeek: string[];
  pickupTime: string;
  estimatedDurationMinutes: number;
  label: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSchedules = async () => {
    setLoading(true);
    const res = await apiGet<Schedule[]>("/api/rides/schedules");
    if (res.ok) setSchedules(res.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  const handleToggle = async (id: string, active: boolean) => {
    await apiPatch(`/api/rides/schedules/${id}`, { active: !active });
    fetchSchedules();
  };

  const handleGenerate = async (id: string) => {
    const weekStart = getNextMonday();
    await apiPost(`/api/rides/schedules/${id}/generate`, { weekStartDate: weekStart });
    alert("Shifts generated for next week");
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Ride Schedules</h1>
        <p className="text-muted-foreground mt-1">
          Recurring ride templates. Shifts are generated each week from active schedules.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No ride schedules yet. Create one from the Passengers page.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {schedules.map((sched) => (
            <Card key={sched.id} className={!sched.active ? "opacity-50" : ""}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">
                        {sched.label ?? "Unnamed schedule"}
                      </span>
                      <Badge variant={sched.active ? "success" : "secondary"}>
                        {sched.active ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="font-mono">{sched.pickupTime}</span>
                      <span>{sched.estimatedDurationMinutes} min</span>
                      <div className="flex gap-1">
                        {DAYS_OF_WEEK.map((d) => (
                          <span
                            key={d.value}
                            className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs font-medium ${
                              sched.daysOfWeek.includes(d.value)
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {d.short[0]}
                          </span>
                        ))}
                      </div>
                    </div>
                    {sched.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{sched.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggle(sched.id, sched.active)}
                    >
                      {sched.active ? "Pause" : "Resume"}
                    </Button>
                    {sched.active && (
                      <Button size="sm" onClick={() => handleGenerate(sched.id)}>
                        Generate Next Week
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function getNextMonday(): string {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? 1 : 8 - day; // next Monday
  const next = new Date(today);
  next.setDate(today.getDate() + diff);
  return next.toISOString().split("T")[0];
}
