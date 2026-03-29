"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

const ZoneMap = dynamic(() => import("@/components/zone-map"), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZonePoint {
  lat: number;
  lng: number;
}

interface Zone {
  id: string;
  name: string;
  color: string;
  polygon: ZonePoint[];
  active: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESET_COLORS = [
  { value: "#3b82f6", label: "Blue" },
  { value: "#22c55e", label: "Green" },
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#a855f7", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#f59e0b", label: "Amber" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultCenter, setDefaultCenter] = useState<
    { lat: number; lng: number; zoom: number } | undefined
  >(undefined);

  // Edit / create form state
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0].value);
  const [formPoints, setFormPoints] = useState<ZonePoint[]>([]);
  const [formActive, setFormActive] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Fetch zones + settings
  const fetchZones = useCallback(async () => {
    const res = await apiGet<Zone[]>("/api/zones");
    if (res.ok && Array.isArray(res.data)) {
      setZones(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchZones();
    // Fetch org settings for default map center
    apiGet<any>("/api/settings").then((res) => {
      if (res.ok && res.data?.serviceArea) {
        const sa = res.data.serviceArea;
        setDefaultCenter({ lat: sa.lat, lng: sa.lng, zoom: sa.zoom });
      }
    });
  }, [fetchZones]);

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------

  function resetForm() {
    setEditingZoneId(null);
    setIsCreating(false);
    setFormName("");
    setFormColor(PRESET_COLORS[0].value);
    setFormPoints([]);
    setFormActive(true);
  }

  function startCreate() {
    resetForm();
    setIsCreating(true);
  }

  function startEdit(zone: Zone) {
    setIsCreating(false);
    setEditingZoneId(zone.id);
    setFormName(zone.name);
    setFormColor(zone.color);
    setFormPoints([...zone.polygon]);
    setFormActive(zone.active);
  }

  function handleAddPoint(lat: number, lng: number) {
    setFormPoints((prev) => [...prev, { lat, lng }]);
  }

  function handleRemovePoint(index: number) {
    setFormPoints((prev) => prev.filter((_, i) => i !== index));
  }

  // ---------------------------------------------------------------------------
  // CRUD actions
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!formName.trim()) return;
    setSaving(true);

    const body = {
      name: formName.trim(),
      color: formColor,
      polygon: formPoints,
      active: formActive,
    };

    if (isCreating) {
      const res = await apiPost<Zone>("/api/zones", body);
      if (res.ok) {
        await fetchZones();
        resetForm();
      }
    } else if (editingZoneId) {
      const res = await apiPut<Zone>(
        `/api/zones/${editingZoneId}`,
        body
      );
      if (res.ok) {
        await fetchZones();
        resetForm();
      }
    }
    setSaving(false);
  }

  async function handleDelete(zoneId: string) {
    const res = await apiDelete(`/api/zones/${zoneId}`);
    // Remove from local state immediately regardless of response
    // (the backend soft-deletes, so re-fetch would also exclude it)
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
    if (editingZoneId === zoneId) resetForm();
    setDeleteConfirmId(null);
    // Also re-fetch to ensure consistency
    fetchZones();
  }

  async function handleToggleActive(zone: Zone) {
    const res = await apiPut<Zone>(`/api/zones/${zone.id}`, {
      ...zone,
      active: !zone.active,
    });
    if (res.ok) {
      await fetchZones();
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-8">Zones</h1>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading zones...
        </div>
      </div>
    );
  }

  const showForm = isCreating || editingZoneId !== null;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Zones</h1>
          <p className="text-muted-foreground mt-1">
            Manage delivery zones and their boundaries.
          </p>
        </div>
        <Button onClick={startCreate} disabled={isCreating}>
          Add Zone
        </Button>
      </div>

      <div className="flex gap-6 min-h-[calc(100vh-12rem)]">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT: Zone list */}
        {/* ----------------------------------------------------------------- */}
        <div className="w-[40%] flex flex-col gap-3 overflow-y-auto pr-2">
          {zones.length === 0 && !showForm && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No zones defined yet. Click &quot;Add Zone&quot; to create one.
              </CardContent>
            </Card>
          )}

          {zones.map((zone) => (
            <Card
              key={zone.id}
              className={`cursor-pointer transition-colors ${
                editingZoneId === zone.id
                  ? "ring-1 ring-primary border-primary"
                  : "hover:bg-accent/30"
              }`}
              onClick={() => startEdit(zone)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-5 w-5 rounded-full border"
                      style={{ backgroundColor: zone.color }}
                    />
                    <div>
                      <p className="text-sm font-medium">{zone.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {zone.polygon.length} point
                        {zone.polygon.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={zone.active ? "success" : "outline"}
                      className="text-xs"
                    >
                      {zone.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* RIGHT: Zone form */}
        {/* ----------------------------------------------------------------- */}
        <div className="w-[60%]">
          {!showForm ? (
            <Card>
              <CardContent className="py-16 text-center">
                <p className="text-muted-foreground">
                  Select a zone to edit, or click &quot;Add Zone&quot; to create
                  a new one.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {isCreating ? "Create New Zone" : "Edit Zone"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Zone Name</label>
                  <Input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., North District"
                    className="max-w-sm"
                  />
                </div>

                {/* Color picker */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setFormColor(c.value)}
                        className={`h-8 w-8 rounded-full border-2 transition-all ${
                          formColor === c.value
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.label}
                      />
                    ))}
                  </div>
                </div>

                {/* Active toggle */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium">Status:</label>
                  <button
                    onClick={() => setFormActive((v) => !v)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      formActive ? "bg-emerald-500" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        formActive ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {formActive ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Zone map */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">
                    Zone Boundary
                  </label>
                  <ZoneMap
                    zones={zones.filter((z) => z.id !== editingZoneId)}
                    editingPoints={formPoints}
                    editingColor={formColor}
                    onAddPoint={handleAddPoint}
                    onUpdatePoints={setFormPoints}
                    defaultCenter={defaultCenter}
                  />

                  {/* Read-only points table */}
                  {formPoints.length > 0 && (
                    <div className="rounded-md border">
                      <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-x-4 px-3 py-2 border-b text-xs font-medium text-muted-foreground">
                        <span>#</span>
                        <span>Latitude</span>
                        <span>Longitude</span>
                        <span />
                      </div>
                      <div className="max-h-[200px] overflow-y-auto">
                        {formPoints.map((pt, i) => (
                          <div
                            key={i}
                            className="grid grid-cols-[auto_1fr_1fr_auto] gap-x-4 items-center px-3 py-2 border-b last:border-0 text-sm"
                          >
                            <span className="text-xs text-muted-foreground w-6">
                              {i + 1}
                            </span>
                            <span className="font-mono text-xs">
                              {pt.lat.toFixed(6)}
                            </span>
                            <span className="font-mono text-xs">
                              {pt.lng.toFixed(6)}
                            </span>
                            <button
                              onClick={() => handleRemovePoint(i)}
                              className="text-muted-foreground hover:text-destructive"
                              title="Remove point"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
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
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {formPoints.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No points added yet. Click on the map to add at least 3
                      points to define a polygon.
                    </p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button onClick={handleSave} disabled={saving || !formName.trim()}>
                    {saving
                      ? "Saving..."
                      : isCreating
                      ? "Create Zone"
                      : "Save Changes"}
                  </Button>
                  <Button variant="ghost" onClick={resetForm}>
                    Cancel
                  </Button>
                </div>

                {editingZoneId && (
                  <div>
                    {deleteConfirmId === editingZoneId ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-destructive">
                          Delete this zone?
                        </span>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(deleteConfirmId!)}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmId(editingZoneId)}
                      >
                        Delete Zone
                      </Button>
                    )}
                  </div>
                )}
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
