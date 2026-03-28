"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost } from "@/lib/api";

interface Delivery {
  id: string;
  recipientName: string;
  recipientAddress: string;
  driverName: string | null;
  driverId: string | null;
  status: string;
  scheduledDate: string;
  completedAt: string | null;
  notes: string;
}

interface Driver {
  id: string;
  name: string;
}

const STATUS_FILTERS = [
  "all",
  "pending",
  "assigned",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
] as const;

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  useEffect(() => {
    async function fetchData() {
      const [deliveriesRes, driversRes] = await Promise.all([
        apiGet<Delivery[]>("/api/deliveries"),
        apiGet<Driver[]>("/api/drivers"),
      ]);

      if (deliveriesRes.ok && Array.isArray(deliveriesRes.data)) {
        setDeliveries(deliveriesRes.data);
      }
      if (driversRes.ok && Array.isArray(driversRes.data)) {
        setDrivers(driversRes.data);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  async function handleAssign(deliveryId: string) {
    if (!selectedDriverId) return;

    const res = await apiPost(`/api/deliveries/${deliveryId}/assign`, {
      driverId: selectedDriverId,
    });

    if (res.ok) {
      const driver = drivers.find((d) => d.id === selectedDriverId);
      setDeliveries((prev) =>
        prev.map((d) =>
          d.id === deliveryId
            ? {
                ...d,
                driverId: selectedDriverId,
                driverName: driver?.name || "Assigned",
                status: "assigned",
              }
            : d
        )
      );
      setAssigningId(null);
      setSelectedDriverId("");
    }
  }

  const filtered = deliveries.filter((d) => {
    const matchesStatus =
      statusFilter === "all" || d.status === statusFilter;
    const matchesSearch =
      !search ||
      d.recipientName.toLowerCase().includes(search.toLowerCase()) ||
      d.recipientAddress.toLowerCase().includes(search.toLowerCase()) ||
      (d.driverName &&
        d.driverName.toLowerCase().includes(search.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const statusCounts = deliveries.reduce<Record<string, number>>(
    (acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Deliveries</h1>
        <p className="text-muted-foreground mt-1">
          View and manage all deliveries, assign drivers, and track status.
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((status) => {
          const count =
            status === "all"
              ? deliveries.length
              : statusCounts[status] || 0;
          const isActive = statusFilter === status;

          return (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <span className="capitalize">{status.replace("_", " ")}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  isActive
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-background text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search by recipient, address, or driver..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  Loading deliveries...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  {search || statusFilter !== "all"
                    ? "No deliveries match your filters."
                    : "No deliveries found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="font-medium">
                    {delivery.recipientName}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {delivery.recipientAddress}
                  </TableCell>
                  <TableCell>
                    {assigningId === delivery.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedDriverId}
                          onChange={(e) =>
                            setSelectedDriverId(e.target.value)
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">Select driver</option>
                          {drivers.map((driver) => (
                            <option key={driver.id} value={driver.id}>
                              {driver.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          onClick={() => handleAssign(delivery.id)}
                          disabled={!selectedDriverId}
                        >
                          OK
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAssigningId(null);
                            setSelectedDriverId("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span
                        className={
                          delivery.driverName
                            ? ""
                            : "text-muted-foreground italic"
                        }
                      >
                        {delivery.driverName || "Unassigned"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={delivery.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(delivery.scheduledDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {delivery.status === "pending" &&
                      assigningId !== delivery.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAssigningId(delivery.id)}
                        >
                          Assign
                        </Button>
                      )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
