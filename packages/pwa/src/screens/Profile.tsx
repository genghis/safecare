import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getProfile, updateProfile, getZones } from "@/lib/api";

const VEHICLE_SIZES: Record<
  string,
  { label: string; defaultMaxDeliveries: number }
> = {
  compact: { label: "Compact / Hatchback", defaultMaxDeliveries: 2 },
  sedan: { label: "Sedan", defaultMaxDeliveries: 3 },
  suv: { label: "SUV / Crossover", defaultMaxDeliveries: 5 },
  minivan: { label: "Minivan", defaultMaxDeliveries: 7 },
  truck: { label: "Pickup / Van", defaultMaxDeliveries: 10 },
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

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 20; h++) {
    slots.push(`${h}:00`);
    if (h < 20) slots.push(`${h}:30`);
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

type DayAvailability = {
  start: string;
  end: string;
};

type Zone = {
  id: string;
  name: string;
  color: string;
};

export default function Profile() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Vehicle state
  const [vehicleSize, setVehicleSize] = useState<string>("sedan");
  const [maxDeliveries, setMaxDeliveries] = useState(3);

  // Availability state
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [dayTimes, setDayTimes] = useState<Record<string, DayAvailability>>({});

  // Zones state
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set());

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [profile, zonesData] = await Promise.all([
        getProfile(),
        getZones(),
      ]);

      setZones(zonesData.zones ?? []);

      if (profile) {
        const p = profile as Record<string, unknown>;
        if (p.vehicleSize && typeof p.vehicleSize === "string" && VEHICLE_SIZES[p.vehicleSize]) {
          setVehicleSize(p.vehicleSize);
        }
        if (typeof p.maxDeliveries === "number") {
          setMaxDeliveries(p.maxDeliveries);
        }
        if (p.availability && typeof p.availability === "object") {
          const avail = p.availability as Record<string, DayAvailability>;
          const days = new Set<string>(Object.keys(avail));
          setSelectedDays(days);
          setDayTimes(avail);
        }
        if (Array.isArray(p.selectedZones)) {
          setSelectedZones(new Set(p.selectedZones as string[]));
        }
      }
    } catch {
      setError("Could not load profile. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSelectVehicle = (key: string) => {
    setVehicleSize(key);
    setMaxDeliveries(VEHICLE_SIZES[key].defaultMaxDeliveries);
  };

  const adjustMaxDeliveries = (delta: number) => {
    setMaxDeliveries((prev) => {
      const next = prev + delta;
      if (next < 1) return 1;
      const cap = VEHICLE_SIZES[vehicleSize].defaultMaxDeliveries;
      if (next > cap) return cap;
      return next;
    });
  };

  const toggleDay = (day: string) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        if (!dayTimes[day]) {
          setDayTimes((t) => ({
            ...t,
            [day]: { start: "9:00", end: "17:00" },
          }));
        }
      }
      return next;
    });
  };

  const setDayTime = (day: string, field: "start" | "end", value: string) => {
    setDayTimes((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const toggleZone = (zoneId: string) => {
    setSelectedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) {
        next.delete(zoneId);
      } else {
        next.add(zoneId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const availability: Record<string, DayAvailability> = {};
      selectedDays.forEach((day) => {
        availability[day] = dayTimes[day] ?? { start: "9:00", end: "17:00" };
      });

      await updateProfile({
        vehicleSize,
        maxDeliveries,
        availability,
        selectedZones: Array.from(selectedZones),
      });

      setSuccess("Your profile has been updated.");
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setError("Could not save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="screen flex-center">
        <div style={{ textAlign: "center" }}>
          <span
            className="spinner spinner-dark"
            style={{ width: 32, height: 32 }}
          />
          <p
            style={{
              marginTop: 12,
              fontSize: 16,
              color: "var(--color-text-secondary)",
            }}
          >
            Loading profile...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {/* Header */}
      <div
        className="flex-between"
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--color-border)",
          backgroundColor: "var(--color-card)",
          flexShrink: 0,
        }}
      >
        <button
          style={{
            background: "none",
            border: "none",
            color: "var(--color-primary)",
            fontSize: 15,
            fontWeight: 600,
            padding: "8px 4px",
            cursor: "pointer",
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          onClick={() => navigate("/dashboard")}
        >
          &#8592; Dashboard
        </button>
        <span style={{ fontSize: 17, fontWeight: 700 }}>My Profile</span>
        <div style={{ width: 90 }} />
      </div>

      {/* Messages */}
      {error && (
        <div
          style={{
            backgroundColor: "var(--color-danger-light)",
            color: "var(--color-danger)",
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div className="banner-success" style={{ borderRadius: 0, flexShrink: 0 }}>
          {success}
        </div>
      )}

      {/* Scrollable content */}
      <div className="screen-scroll" style={{ padding: "0 20px 48px" }}>
        {/* Vehicle Section */}
        <p className="section-title">Vehicle</p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          {Object.entries(VEHICLE_SIZES).map(([key, v]) => {
            const isSelected = vehicleSize === key;
            return (
              <button
                key={key}
                onClick={() => handleSelectVehicle(key)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "14px 12px",
                  minHeight: 72,
                  borderRadius: "var(--radius-md)",
                  border: `2px solid ${isSelected ? "var(--color-primary)" : "var(--color-border-strong)"}`,
                  backgroundColor: isSelected
                    ? "var(--color-primary)"
                    : "var(--color-card)",
                  cursor: "pointer",
                  transition: "all var(--transition)",
                }}
                aria-pressed={isSelected}
              >
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: isSelected ? "#fff" : "var(--color-text)",
                    textAlign: "center",
                  }}
                >
                  {v.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: isSelected
                      ? "rgba(255,255,255,0.8)"
                      : "var(--color-text-muted)",
                    marginTop: 2,
                  }}
                >
                  up to {v.defaultMaxDeliveries} deliveries
                </span>
              </button>
            );
          })}
        </div>

        {/* Max deliveries stepper */}
        <p
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--color-text)",
            marginTop: 20,
            marginBottom: 10,
          }}
        >
          Max deliveries per shift
        </p>
        <div className="flex-row items-center" style={{ gap: 16 }}>
          <button
            onClick={() => adjustMaxDeliveries(-1)}
            style={{
              width: 52,
              height: 52,
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--color-card)",
              border: "2px solid var(--color-primary)",
              fontSize: 24,
              fontWeight: 700,
              color: "var(--color-primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            -
          </button>
          <span
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "var(--color-text)",
              minWidth: 40,
              textAlign: "center",
            }}
          >
            {maxDeliveries}
          </span>
          <button
            onClick={() => adjustMaxDeliveries(1)}
            style={{
              width: 52,
              height: 52,
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--color-card)",
              border: "2px solid var(--color-primary)",
              fontSize: 24,
              fontWeight: 700,
              color: "var(--color-primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            +
          </button>
        </div>

        {/* Availability Section */}
        <p className="section-title">Availability</p>
        <div className="flex-row" style={{ gap: 6 }}>
          {DAYS_OF_WEEK.map((d) => {
            const isSelected = selectedDays.has(d.value);
            return (
              <button
                key={d.value}
                onClick={() => toggleDay(d.value)}
                aria-pressed={isSelected}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 8,
                  border: "none",
                  backgroundColor: isSelected
                    ? "var(--color-primary)"
                    : "var(--color-border-strong)",
                  color: isSelected ? "#fff" : "var(--color-text-secondary)",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all var(--transition)",
                }}
              >
                {d.short}
              </button>
            );
          })}
        </div>

        {/* Time ranges for selected days */}
        {DAYS_OF_WEEK.filter((d) => selectedDays.has(d.value)).map((d) => (
          <div
            key={d.value}
            className="card-static"
            style={{ marginTop: 10, padding: 12 }}
          >
            <p
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--color-text)",
                marginBottom: 8,
              }}
            >
              {d.short}
            </p>

            {/* Start time */}
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                display: "block",
                marginBottom: 4,
              }}
            >
              Start
            </label>
            <select
              className="select"
              value={dayTimes[d.value]?.start ?? "9:00"}
              onChange={(e) => setDayTime(d.value, "start", e.target.value)}
              style={{ marginBottom: 8 }}
            >
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {/* End time */}
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                display: "block",
                marginBottom: 4,
              }}
            >
              End
            </label>
            <select
              className="select"
              value={dayTimes[d.value]?.end ?? "17:00"}
              onChange={(e) => setDayTime(d.value, "end", e.target.value)}
            >
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ))}

        {/* Delivery Zones Section */}
        <p className="section-title">Areas I Can Deliver To</p>
        {zones.length === 0 ? (
          <p
            style={{
              fontSize: 15,
              color: "var(--color-text-muted)",
              fontStyle: "italic",
            }}
          >
            No delivery zones available.
          </p>
        ) : (
          <div className="flex-wrap" style={{ display: "flex", gap: 10 }}>
            {zones.map((zone) => {
              const isSelected = selectedZones.has(zone.id);
              return (
                <button
                  key={zone.id}
                  className="chip"
                  onClick={() => toggleZone(zone.id)}
                  aria-pressed={isSelected}
                  style={{
                    backgroundColor: isSelected ? zone.color : "#f0f0f0",
                    borderColor: zone.color,
                    color: isSelected ? "#fff" : "var(--color-text)",
                  }}
                >
                  {isSelected && (
                    <span style={{ marginRight: 4 }}>&#10003;</span>
                  )}
                  {zone.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Save button */}
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 32, minHeight: 64, fontSize: 20 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <span className="spinner" /> : "Save Profile"}
        </button>
      </div>
    </div>
  );
}
