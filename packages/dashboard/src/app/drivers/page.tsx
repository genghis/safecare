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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost, apiPut, apiPatch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DriverAvailability {
  day: string;
  startTime: string;
  endTime: string;
}

interface Driver {
  id: string;
  name: string;
  phone: string;
  vetted: boolean;
  vehicleSize: string;
  vehicle: string;
  maxDeliveries: number;
  team: string;
  status: string;
  availability: DriverAvailability[];
  zones: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants (hardcoded from shared/constants to avoid import issues)
// ---------------------------------------------------------------------------

const VEHICLE_SIZE_LABELS: Record<string, { label: string; max: number }> = {
  compact: { label: "Compact / Hatchback", max: 2 },
  sedan: { label: "Sedan", max: 3 },
  suv: { label: "SUV / Crossover", max: 5 },
  minivan: { label: "Minivan", max: 7 },
  truck: { label: "Pickup / Van", max: 10 },
};

const DAYS_OF_WEEK = [
  { value: "mon", short: "Mon" },
  { value: "tue", short: "Tue" },
  { value: "wed", short: "Wed" },
  { value: "thu", short: "Thu" },
  { value: "fri", short: "Fri" },
  { value: "sat", short: "Sat" },
  { value: "sun", short: "Sun" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit modal state
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editVehicleSize, setEditVehicleSize] = useState("");
  const [editMaxDeliveries, setEditMaxDeliveries] = useState(0);
  const [editTeam, setEditTeam] = useState("");
  const [editAvailability, setEditAvailability] = useState<DriverAvailability[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addVehicleSize, setAddVehicleSize] = useState("sedan");
  const [addMaxDeliveries, setAddMaxDeliveries] = useState(3);
  const [addTeam, setAddTeam] = useState("");
  const [addAvailability, setAddAvailability] = useState<DriverAvailability[]>([]);
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    async function fetchDrivers() {
      const res = await apiGet<Driver[]>("/api/drivers");
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getVehicleSizeLabel(size: string): string {
    const v = VEHICLE_SIZE_LABELS[size];
    return v ? v.label : size || "N/A";
  }

  function getAvailabilityDays(avail: DriverAvailability[] | undefined): string {
    if (!avail || avail.length === 0) return "Not set";
    const days = [...new Set(avail.map((a) => a.day))];
    return days
      .map((d) => {
        const found = DAYS_OF_WEEK.find((dw) => dw.value === d);
        return found ? found.short : d;
      })
      .join(", ");
  }

  function getZoneDisplay(zones: string[] | undefined): string {
    if (!zones || zones.length === 0) return "None";
    if (zones.length <= 2) return zones.join(", ");
    return `${zones.length} zones`;
  }

  // ---------------------------------------------------------------------------
  // Edit modal
  // ---------------------------------------------------------------------------

  function openEdit(driver: Driver) {
    setEditingDriver(driver);
    setEditName(driver.name);
    setEditPhone(driver.phone);
    setEditVehicleSize(driver.vehicleSize || "sedan");
    setEditMaxDeliveries(driver.maxDeliveries || VEHICLE_SIZE_LABELS[driver.vehicleSize]?.max || 5);
    setEditTeam(driver.team || "");
    setEditAvailability(driver.availability || []);
  }

  function closeEdit() {
    setEditingDriver(null);
  }

  function handleToggleAvailDay(dayValue: string) {
    const exists = editAvailability.some((a) => a.day === dayValue);
    if (exists) {
      setEditAvailability((prev) => prev.filter((a) => a.day !== dayValue));
    } else {
      setEditAvailability((prev) => [
        ...prev,
        { day: dayValue, startTime: "09:00", endTime: "17:00" },
      ]);
    }
  }

  function handleAvailTimeChange(
    dayValue: string,
    field: "startTime" | "endTime",
    value: string
  ) {
    setEditAvailability((prev) =>
      prev.map((a) => (a.day === dayValue ? { ...a, [field]: value } : a))
    );
  }

  async function handleSaveEdit() {
    if (!editingDriver) return;
    setEditSaving(true);

    const res = await apiPut<Driver>(
      `/api/drivers/${editingDriver.id}/profile`,
      {
        name: editName,
        phone: editPhone,
        vehicleSize: editVehicleSize,
        maxDeliveries: editMaxDeliveries,
        team: editTeam,
        availability: editAvailability,
      }
    );

    if (res.ok) {
      setDrivers((prev) =>
        prev.map((d) =>
          d.id === editingDriver.id
            ? {
                ...d,
                name: editName,
                phone: editPhone,
                vehicleSize: editVehicleSize,
                maxDeliveries: editMaxDeliveries,
                team: editTeam,
                availability: editAvailability,
              }
            : d
        )
      );
      closeEdit();
    }
    setEditSaving(false);
  }

  // ---------------------------------------------------------------------------
  // Add modal
  // ---------------------------------------------------------------------------

  function openAddModal() {
    setAddName("");
    setAddPhone("");
    setAddEmail("");
    setAddVehicleSize("sedan");
    setAddMaxDeliveries(VEHICLE_SIZE_LABELS["sedan"].max);
    setAddTeam("");
    setAddAvailability([]);
    setShowAddModal(true);
  }

  function closeAddModal() {
    setShowAddModal(false);
  }

  function handleToggleAddAvailDay(dayValue: string) {
    const exists = addAvailability.some((a) => a.day === dayValue);
    if (exists) {
      setAddAvailability((prev) => prev.filter((a) => a.day !== dayValue));
    } else {
      setAddAvailability((prev) => [
        ...prev,
        { day: dayValue, startTime: "09:00", endTime: "17:00" },
      ]);
    }
  }

  function handleAddAvailTimeChange(
    dayValue: string,
    field: "startTime" | "endTime",
    value: string
  ) {
    setAddAvailability((prev) =>
      prev.map((a) => (a.day === dayValue ? { ...a, [field]: value } : a))
    );
  }

  async function handleSaveAdd() {
    if (!addName || !addPhone) return;
    setAddSaving(true);

    const res = await apiPost<{ success: boolean; data: Driver }>(
      "/api/drivers",
      {
        name: addName,
        phone: addPhone,
        email: addEmail,
        vehicleSize: addVehicleSize,
        maxDeliveries: addMaxDeliveries,
        team: addTeam,
        availability: addAvailability,
      }
    );

    if (res.ok) {
      const newDriver: Driver = {
        id: (res.data as any)?.id ?? "",
        name: addName,
        phone: addPhone,
        vetted: false,
        vehicleSize: addVehicleSize,
        vehicle: addVehicleSize,
        maxDeliveries: addMaxDeliveries,
        team: addTeam,
        status: "pending",
        availability: addAvailability,
        zones: [],
        createdAt: new Date().toISOString(),
      };
      setDrivers((prev) => [...prev, newDriver]);
      closeAddModal();
    }
    setAddSaving(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Drivers</h1>
          <p className="text-muted-foreground mt-1">
            Manage volunteer drivers, availability, and capacity.
          </p>
        </div>
        <Button onClick={openAddModal}>Add Driver</Button>
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
              <TableHead>Vehicle Size</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>Zones</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="h-24 text-center text-muted-foreground"
                >
                  Loading drivers...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="h-24 text-center text-muted-foreground"
                >
                  {search
                    ? "No drivers match your search."
                    : "No drivers found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((driver) => {
                const isExpanded = expandedId === driver.id;
                const vehicleInfo = VEHICLE_SIZE_LABELS[driver.vehicleSize];

                return (
                  <TableRow
                    key={driver.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : driver.id)
                    }
                  >
                    <TableCell className="font-medium">
                      {driver.name}
                    </TableCell>
                    <TableCell>{driver.phone}</TableCell>
                    <TableCell>
                      <StatusBadge status={driver.status || "offline"} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={driver.vetted ? "vetted" : "not_vetted"}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {getVehicleSizeLabel(driver.vehicleSize || driver.vehicle)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {driver.maxDeliveries || vehicleInfo?.max || "N/A"} max
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {getAvailabilityDays(driver.availability)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {getZoneDisplay(driver.zones)}
                      </span>
                    </TableCell>
                    <TableCell>{driver.team || "Unassigned"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(driver.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Expanded detail panel */}
      {expandedId && (
        <DriverDetailPanel
          driver={filtered.find((d) => d.id === expandedId) || null}
          onClose={() => setExpandedId(null)}
          onEdit={(d) => openEdit(d)}
          onStatusChange={async (driverId, status) => {
            const res = await apiPatch(`/api/drivers/${driverId}/status`, { status });
            if (res.ok) {
              setDrivers((prev) =>
                prev.map((d) => d.id === driverId ? { ...d, status } : d)
              );
            }
          }}
        />
      )}

      {/* Edit modal */}
      {editingDriver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto py-8"
        >
          <div
            className="w-full max-w-lg rounded-lg border bg-card p-0 shadow-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Card className="border-0 shadow-none">
              <CardHeader>
                <CardTitle className="text-lg">Edit Driver</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Name */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Phone</label>
                  <Input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                  />
                </div>

                {/* Vehicle Size */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Vehicle Size</label>
                  <select
                    value={editVehicleSize}
                    onChange={(e) => {
                      setEditVehicleSize(e.target.value);
                      const v = VEHICLE_SIZE_LABELS[e.target.value];
                      if (v) setEditMaxDeliveries(v.max);
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {Object.entries(VEHICLE_SIZE_LABELS).map(([key, val]) => (
                      <option key={key} value={key}>
                        {val.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Max Deliveries */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Max Deliveries</label>
                  <Input
                    type="number"
                    min={1}
                    value={editMaxDeliveries}
                    onChange={(e) =>
                      setEditMaxDeliveries(parseInt(e.target.value) || 1)
                    }
                    className="max-w-[120px]"
                  />
                </div>

                {/* Team */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Team</label>
                  <Input
                    value={editTeam}
                    onChange={(e) => setEditTeam(e.target.value)}
                  />
                </div>

                {/* Availability */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Availability</label>
                  <div className="space-y-2">
                    {DAYS_OF_WEEK.map((day) => {
                      const avail = editAvailability.find(
                        (a) => a.day === day.value
                      );
                      const isActive = !!avail;
                      return (
                        <div
                          key={day.value}
                          className="flex items-center gap-3"
                        >
                          <button
                            onClick={() => handleToggleAvailDay(day.value)}
                            className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors w-12 ${
                              isActive
                                ? "border-primary bg-accent/50 ring-1 ring-primary"
                                : "border-border hover:bg-accent/30"
                            }`}
                          >
                            {day.short}
                          </button>
                          {isActive && avail && (
                            <div className="flex items-center gap-1 text-xs">
                              <Input
                                type="time"
                                value={avail.startTime}
                                onChange={(e) =>
                                  handleAvailTimeChange(
                                    day.value,
                                    "startTime",
                                    e.target.value
                                  )
                                }
                                className="h-8 w-28 text-xs"
                              />
                              <span className="text-muted-foreground">to</span>
                              <Input
                                type="time"
                                value={avail.endTime}
                                onChange={(e) =>
                                  handleAvailTimeChange(
                                    day.value,
                                    "endTime",
                                    e.target.value
                                  )
                                }
                                className="h-8 w-28 text-xs"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
              <div className="flex items-center justify-end gap-2 p-6 pt-0">
                <Button variant="ghost" onClick={closeEdit}>
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} disabled={editSaving}>
                  {editSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Add Driver modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto py-8"
        >
          <div
            className="w-full max-w-lg rounded-lg border bg-card p-0 shadow-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Card className="border-0 shadow-none">
              <CardHeader>
                <CardTitle className="text-lg">Add Driver</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Name */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Name *</label>
                  <Input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="Full name"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Phone *</label>
                  <Input
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="driver@example.com"
                  />
                </div>

                {/* Vehicle Size */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Vehicle Size</label>
                  <select
                    value={addVehicleSize}
                    onChange={(e) => {
                      setAddVehicleSize(e.target.value);
                      const v = VEHICLE_SIZE_LABELS[e.target.value];
                      if (v) setAddMaxDeliveries(v.max);
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {Object.entries(VEHICLE_SIZE_LABELS).map(([key, val]) => (
                      <option key={key} value={key}>
                        {val.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Max Deliveries */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Max Deliveries</label>
                  <Input
                    type="number"
                    min={1}
                    value={addMaxDeliveries}
                    onChange={(e) =>
                      setAddMaxDeliveries(parseInt(e.target.value) || 1)
                    }
                    className="max-w-[120px]"
                  />
                </div>

                {/* Team */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Team</label>
                  <Input
                    value={addTeam}
                    onChange={(e) => setAddTeam(e.target.value)}
                    placeholder="Team name"
                  />
                </div>

                {/* Availability */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Availability</label>
                  <div className="space-y-2">
                    {DAYS_OF_WEEK.map((day) => {
                      const avail = addAvailability.find(
                        (a) => a.day === day.value
                      );
                      const isActive = !!avail;
                      return (
                        <div
                          key={day.value}
                          className="flex items-center gap-3"
                        >
                          <button
                            onClick={() => handleToggleAddAvailDay(day.value)}
                            className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors w-12 ${
                              isActive
                                ? "border-primary bg-accent/50 ring-1 ring-primary"
                                : "border-border hover:bg-accent/30"
                            }`}
                          >
                            {day.short}
                          </button>
                          {isActive && avail && (
                            <div className="flex items-center gap-1 text-xs">
                              <Input
                                type="time"
                                value={avail.startTime}
                                onChange={(e) =>
                                  handleAddAvailTimeChange(
                                    day.value,
                                    "startTime",
                                    e.target.value
                                  )
                                }
                                className="h-8 w-28 text-xs"
                              />
                              <span className="text-muted-foreground">to</span>
                              <Input
                                type="time"
                                value={avail.endTime}
                                onChange={(e) =>
                                  handleAddAvailTimeChange(
                                    day.value,
                                    "endTime",
                                    e.target.value
                                  )
                                }
                                className="h-8 w-28 text-xs"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
              <div className="flex items-center justify-end gap-2 p-6 pt-0">
                <Button variant="ghost" onClick={closeAddModal}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveAdd}
                  disabled={addSaving || !addName || !addPhone}
                >
                  {addSaving ? "Adding..." : "Add Driver"}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driver detail panel (expandable below table)
// ---------------------------------------------------------------------------

function DriverDetailPanel({
  driver,
  onClose,
  onEdit,
  onStatusChange,
}: {
  driver: Driver | null;
  onClose: () => void;
  onEdit: (driver: Driver) => void;
  onStatusChange: (driverId: string, status: string) => void;
}) {
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  if (!driver) return null;

  const vehicleInfo = VEHICLE_SIZE_LABELS[driver.vehicleSize];

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg">
          {driver.name} — Details
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(driver)}
          >
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Vehicle info */}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Vehicle</span>
            <p className="text-sm font-medium">
              {vehicleInfo
                ? `${vehicleInfo.label} (${driver.maxDeliveries || vehicleInfo.max} max)`
                : driver.vehicle || "N/A"}
            </p>
          </div>

          {/* Team */}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Team</span>
            <p className="text-sm font-medium">
              {driver.team || "Unassigned"}
            </p>
          </div>

          {/* Phone */}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Phone</span>
            <p className="text-sm font-medium">{driver.phone}</p>
          </div>
        </div>

        {/* Availability schedule */}
        <div className="mt-6">
          <h3 className="text-sm font-medium mb-3">Availability Schedule</h3>
          {(!driver.availability || driver.availability.length === 0) ? (
            <p className="text-sm text-muted-foreground">
              No availability set.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {DAYS_OF_WEEK.map((day) => {
                const avail = (driver.availability || []).find(
                  (a) => a.day === day.value
                );
                return (
                  <div
                    key={day.value}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      avail
                        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <span className="font-medium">{day.short}</span>
                    {avail ? (
                      <span className="ml-2 text-xs">
                        {avail.startTime} - {avail.endTime}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs">Unavailable</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Zones */}
        <div className="mt-6">
          <h3 className="text-sm font-medium mb-3">Assigned Zones</h3>
          {(!driver.zones || driver.zones.length === 0) ? (
            <p className="text-sm text-muted-foreground">
              No zones assigned.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {driver.zones.map((zone, i) => (
                <Badge key={i} variant="outline">
                  {zone}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Vetting workflow */}
        <div className="mt-6">
          <h3 className="text-sm font-medium mb-3">Vetting Status</h3>
          <div className="flex items-center gap-3">
            <StatusBadge status={driver.status === "vetted" ? "vetted" : driver.status === "suspended" ? "suspended" : "not_vetted"} />
            <div className="flex gap-2">
              {(driver.status === "pending" || !driver.status) && (
                <>
                  <Button
                    size="sm"
                    onClick={() => onStatusChange(driver.id, "vetted")}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Approve (Vet)
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setConfirmSuspend(true)}
                  >
                    Suspend
                  </Button>
                </>
              )}
              {driver.status === "vetted" && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmSuspend(true)}
                >
                  Suspend
                </Button>
              )}
              {driver.status === "suspended" && (
                <Button
                  size="sm"
                  onClick={() => onStatusChange(driver.id, "vetted")}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Reinstate
                </Button>
              )}
            </div>
          </div>
          {confirmSuspend && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <span className="text-sm text-destructive">
                Suspend this driver? They will not receive routes.
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  onStatusChange(driver.id, "suspended");
                  setConfirmSuspend(false);
                }}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmSuspend(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
