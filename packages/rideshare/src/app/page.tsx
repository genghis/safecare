"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";

interface RideStats {
  todaysRides: number;
  openShifts: number;
  claimedShifts: number;
  confirmedShifts: number;
  inProgressShifts: number;
  completedToday: number;
  pendingIntake: number;
  activeSchedules: number;
}

interface ReferralStats {
  totalProviders: number;
  activeProviders: number;
  underReview: number;
  categoryBreakdown: Record<string, number>;
}

interface ShiftRow {
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

const serviceTypeColors: Record<string, string> = {
  ride: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  transit_escort: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  delivery: "bg-green-500/15 text-green-700 dark:text-green-400",
};

export default function TodaysAsksPage() {
  const [rideStats, setRideStats] = useState<RideStats | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [todaysShifts, setTodaysShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const today = new Date().toISOString().split("T")[0];

      const [statsRes, refStatsRes, shiftsRes] = await Promise.all([
        apiGet<RideStats>("/api/rides/stats"),
        apiGet<ReferralStats>("/api/referrals/stats"),
        apiGet<ShiftRow[]>(`/api/rides/shifts?from=${today}&to=${today}`),
      ]);

      if (statsRes.ok) setRideStats(statsRes.data);
      if (refStatsRes.ok) setReferralStats(refStatsRes.data);
      if (shiftsRes.ok) setTodaysShifts(shiftsRes.data);
      setLoading(false);
    }
    fetchData();
  }, []);

  const statCards = [
    {
      title: "Today's Rides",
      value: rideStats?.todaysRides ?? 0,
      description: `${rideStats?.openShifts ?? 0} open, ${rideStats?.inProgressShifts ?? 0} active`,
    },
    {
      title: "Pending Intake",
      value: rideStats?.pendingIntake ?? 0,
      description: "Ride requests awaiting processing",
    },
    {
      title: "Active Schedules",
      value: rideStats?.activeSchedules ?? 0,
      description: "Recurring ride templates",
    },
    {
      title: "Referral Directory",
      value: referralStats?.activeProviders ?? 0,
      description: `${referralStats?.underReview ?? 0} under review`,
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Today's Asks</h1>
        <p className="text-muted-foreground mt-1">
          Rides, transit escorts, and referral requests — everything that needs attention today.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {statCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
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

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Today's Shift Board</h2>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : todaysShifts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No rides scheduled for today. Check the intake queue for new requests.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {todaysShifts.map((shift) => (
              <Card key={shift.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-lg font-mono font-semibold w-16">
                      {shift.pickupTime}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${serviceTypeColors[shift.serviceType] ?? serviceTypeColors.ride}`}>
                          {shift.serviceType === "transit_escort" ? "Transit Escort" : "Ride"}
                        </span>
                        <span className="font-medium">
                          {shift.label ?? `${shift.pickupNeighborhood ?? "?"} to ${shift.dropoffNeighborhood ?? "?"}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        {shift.requiresCleanVehicle && (
                          <span className="text-green-600 dark:text-green-400 font-medium">Clean vehicle</span>
                        )}
                        {shift.passengerCount > 1 && (
                          <span>{shift.passengerCount} passengers</span>
                        )}
                        {shift.carSeatRequired && (
                          <span>Car seat needed</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Badge variant={statusColors[shift.status] ?? "default"}>
                    {shift.status.replace("_", " ")}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
