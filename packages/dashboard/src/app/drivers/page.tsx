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
import { apiGet } from "@/lib/api";

interface Driver {
  id: string;
  name: string;
  phone: string;
  vetted: boolean;
  vehicle: string;
  team: string;
  status: string;
  createdAt: string;
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDrivers() {
      const res = await apiGet<Driver[]>("/api/admin/drivers");
      if (res.ok && Array.isArray(res.data)) {
        setDrivers(res.data);
      }
      setLoading(false);
    }
    fetchDrivers();
  }, []);

  const filtered = drivers.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.phone.includes(search) ||
      d.team.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Drivers</h1>
          <p className="text-muted-foreground mt-1">
            Manage volunteer drivers and their vetting status.
          </p>
        </div>
        <Button>Add Driver</Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search by name, phone, or team..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Vetted</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Loading drivers...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {search ? "No drivers match your search." : "No drivers found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((driver) => (
                <TableRow key={driver.id}>
                  <TableCell className="font-medium">{driver.name}</TableCell>
                  <TableCell>{driver.phone}</TableCell>
                  <TableCell>
                    <StatusBadge status={driver.status || "offline"} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={driver.vetted ? "vetted" : "not_vetted"} />
                  </TableCell>
                  <TableCell>{driver.vehicle || "N/A"}</TableCell>
                  <TableCell>{driver.team || "Unassigned"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(driver.createdAt).toLocaleDateString()}
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
