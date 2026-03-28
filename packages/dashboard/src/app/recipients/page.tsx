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

interface Recipient {
  id: string;
  name: string;
  phone: string;
  address: string;
  verified: boolean;
  communicationPreference: string;
  createdAt: string;
}

export default function RecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRecipients() {
      const res = await apiGet<Recipient[]>("/api/admin/recipients");
      if (res.ok && Array.isArray(res.data)) {
        setRecipients(res.data);
      }
      setLoading(false);
    }
    fetchRecipients();
  }, []);

  const filtered = recipients.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.phone.includes(search) ||
      r.address.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recipients</h1>
          <p className="text-muted-foreground mt-1">
            Manage mutual aid recipients and their delivery preferences.
          </p>
        </div>
        <Button>Add Recipient</Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search by name, phone, or address..."
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
              <TableHead>Address</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Communication</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  Loading recipients...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {search ? "No recipients match your search." : "No recipients found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((recipient) => (
                <TableRow key={recipient.id}>
                  <TableCell className="font-medium">{recipient.name}</TableCell>
                  <TableCell>{recipient.phone}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{recipient.address}</TableCell>
                  <TableCell>
                    <StatusBadge status={recipient.verified ? "verified" : "unverified"} />
                  </TableCell>
                  <TableCell className="capitalize">{recipient.communicationPreference}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(recipient.createdAt).toLocaleDateString()}
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
