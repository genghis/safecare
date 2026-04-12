"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api";
import { INTAKE_SOURCES } from "@safecare/shared";

interface IntakeRequest {
  id: string;
  source: string;
  sourceIdentifier: string | null;
  rawText: string | null;
  parsedData: Record<string, unknown> | null;
  status: string;
  processedBy: string | null;
  processedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

const sourceIcons: Record<string, string> = {
  whatsapp: "WA",
  signal: "SG",
  jotform: "JF",
  web_form: "WF",
  manual: "MN",
};

export default function IntakePage() {
  const [requests, setRequests] = useState<IntakeRequest[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);

  const fetchIntake = async () => {
    setLoading(true);
    const url = filter ? `/api/rides/intake?status=${filter}` : "/api/rides/intake";
    const res = await apiGet<IntakeRequest[]>(url);
    if (res.ok) setRequests(res.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchIntake();
  }, [filter]);

  const handleProcess = async (id: string) => {
    await apiPost(`/api/rides/intake/${id}/process`, { status: "processed" });
    fetchIntake();
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Rejection reason:");
    if (reason === null) return;
    await apiPost(`/api/rides/intake/${id}/process`, { status: "rejected", rejectionReason: reason });
    fetchIntake();
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Intake Queue</h1>
        <p className="text-muted-foreground mt-1">
          Incoming ride requests from WhatsApp, Signal, JotForm, and manual entry.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {["pending", "processed", "rejected", ""].map((status) => (
          <Button
            key={status || "all"}
            size="sm"
            variant={filter === status ? "default" : "outline"}
            onClick={() => setFilter(status)}
          >
            {status || "All"}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No intake requests matching the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <Card key={req.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-muted text-xs font-bold">
                        {sourceIcons[req.source] ?? "?"}
                      </span>
                      <span className="text-sm font-medium">
                        {INTAKE_SOURCES[req.source]?.label ?? req.source}
                      </span>
                      <Badge variant={
                        req.status === "pending" ? "warning" :
                        req.status === "processed" ? "success" : "destructive"
                      }>
                        {req.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(req.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {req.rawText && (
                      <div className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap mb-2">
                        {req.rawText}
                      </div>
                    )}

                    {req.parsedData && Object.keys(req.parsedData).length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {Object.entries(req.parsedData).map(([key, value]) => (
                          <span key={key} className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs">
                            <span className="font-medium">{key}:</span> {String(value)}
                          </span>
                        ))}
                      </div>
                    )}

                    {req.rejectionReason && (
                      <p className="text-sm text-destructive">Rejected: {req.rejectionReason}</p>
                    )}
                  </div>

                  {req.status === "pending" && (
                    <div className="flex items-center gap-2 ml-4">
                      <Button size="sm" onClick={() => handleProcess(req.id)}>Process</Button>
                      <Button size="sm" variant="outline" onClick={() => handleReject(req.id)}>Reject</Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
