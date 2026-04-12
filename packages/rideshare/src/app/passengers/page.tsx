"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { apiGet } from "@/lib/api";

interface Recipient {
  id: string;
  name: string;
  displayId: string | null;
  phone: string;
  language: string;
  serviceTypes: string[];
  verified: boolean;
}

export default function PassengersPage() {
  const [passengers, setPassengers] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const res = await apiGet<Recipient[]>("/api/recipients");
      if (res.ok) {
        // Filter to ride recipients
        setPassengers(res.data.filter(r => r.serviceTypes?.includes("ride")));
      }
      setLoading(false);
    }
    fetch();
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Passengers</h1>
        <p className="text-muted-foreground mt-1">
          People receiving rides. Manage saved locations, schedules, and driver relationships.
        </p>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : passengers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No ride passengers yet. Add recipients and set their service type to include rides.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passengers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-sm">
                    {p.displayId ?? p.id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.language?.toUpperCase()}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {p.serviceTypes?.map((st) => (
                        <Badge key={st} variant="secondary" className="text-xs">
                          {st}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.verified ? "success" : "warning"}>
                      {p.verified ? "Verified" : "Unverified"}
                    </Badge>
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
