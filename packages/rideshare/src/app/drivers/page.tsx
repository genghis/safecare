"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import { VEHICLE_STATUSES, SERVICE_RADII, VEHICLE_SIZES } from "@safecare/shared";

interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicleSize: string;
  vehicleModel: string;
  vehicleStatus: string;
  passengerCapacity: number;
  maxDeliveries: number;
  insuranceVerified: boolean;
  serviceRadius: string;
  serviceTypes: string[];
  languages: string[];
  vettedStatus: string;
}

const vehicleStatusColors: Record<string, "success" | "destructive" | "warning"> = {
  clean: "success",
  hot: "destructive",
  unknown: "warning",
};

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleFilter, setVehicleFilter] = useState("");

  useEffect(() => {
    async function fetch() {
      const res = await apiGet<Driver[]>("/api/drivers");
      if (res.ok) {
        // Filter to ride/transit_escort drivers
        setDrivers(res.data.filter(d =>
          d.serviceTypes?.some(st => st === "ride" || st === "transit_escort"),
        ));
      }
      setLoading(false);
    }
    fetch();
  }, []);

  const filtered = vehicleFilter
    ? drivers.filter(d => d.vehicleStatus === vehicleFilter)
    : drivers;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Drivers & Vehicles</h1>
        <p className="text-muted-foreground mt-1">
          Vehicle status, capacity, insurance, and service radius for ride-eligible drivers.
        </p>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <span className="text-sm text-muted-foreground">Vehicle status:</span>
        <div className="flex gap-2">
          {["", "clean", "hot", "unknown"].map((status) => (
            <button
              key={status || "all"}
              onClick={() => setVehicleFilter(status)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                vehicleFilter === status
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:bg-accent"
              }`}
            >
              {status ? (VEHICLE_STATUSES[status]?.label ?? status) : "All"}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} driver{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No ride-eligible drivers found.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Passengers</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Insurance</TableHead>
                <TableHead>Radius</TableHead>
                <TableHead>Languages</TableHead>
                <TableHead>Services</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {VEHICLE_SIZES[d.vehicleSize]?.label ?? d.vehicleSize}
                    </div>
                    {d.vehicleModel && (
                      <div className="text-xs text-muted-foreground">{d.vehicleModel}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={vehicleStatusColors[d.vehicleStatus] ?? "warning"}>
                      {VEHICLE_STATUSES[d.vehicleStatus]?.label ?? d.vehicleStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{d.passengerCapacity ?? 4}</TableCell>
                  <TableCell className="text-center">{d.maxDeliveries}</TableCell>
                  <TableCell>
                    <Badge variant={d.insuranceVerified ? "success" : "secondary"}>
                      {d.insuranceVerified ? "Verified" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {SERVICE_RADII[d.serviceRadius]?.label ?? d.serviceRadius}
                  </TableCell>
                  <TableCell>
                    {d.languages?.join(", ") || "en"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {d.serviceTypes?.map((st) => (
                        <Badge key={st} variant="outline" className="text-xs">
                          {st === "transit_escort" ? "escort" : st}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
