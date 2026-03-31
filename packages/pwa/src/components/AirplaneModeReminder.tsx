/**
 * Airplane mode reminder component.
 *
 * Watches the driver's GPS position and shows a dismissible banner when
 * they approach or enter the delivery zone bounding box. Also plays a
 * loud audio alert when within ~500 m of an individual delivery stop.
 * Each stop only triggers the audio once per session.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocale } from "@/lib/locale";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StopLocation {
  deliveryId: string;
  lat: number;
  lng: number;
  status?: string;
}

export interface AirplaneModeReminderProps {
  deliveryZoneBounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  } | null;
  /** Individual stop coordinates for per-stop proximity alerts. */
  stops?: StopLocation[];
  /** Driver's current GPS position (updated externally). */
  currentLocation?: { lat: number; lng: number } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Distance in meters at which the audio alert fires for a stop. */
const STOP_ALERT_RADIUS_M = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate km-per-degree at moderate latitudes. */
const KM_PER_DEG_LAT = 111.32;

/**
 * Returns `true` if `(lat, lng)` is within `bufferKm` of the bounding box.
 */
function isNearBounds(
  lat: number,
  lng: number,
  bounds: { south: number; west: number; north: number; east: number },
  bufferKm: number,
): boolean {
  const bufferLat = bufferKm / KM_PER_DEG_LAT;
  const midLat = (bounds.south + bounds.north) / 2;
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const bufferLng = bufferKm / kmPerDegLng;

  return (
    lat >= bounds.south - bufferLat &&
    lat <= bounds.north + bufferLat &&
    lng >= bounds.west - bufferLng &&
    lng <= bounds.east + bufferLng
  );
}

/**
 * Returns `true` if `(lat, lng)` is strictly inside the bounding box.
 */
function isInsideBounds(
  lat: number,
  lng: number,
  bounds: { south: number; west: number; north: number; east: number },
): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}

/**
 * Haversine distance between two lat/lng points in meters.
 */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Play a loud two-tone alert using the Web Audio API.
 * Works offline — no external audio files needed.
 */
function playProximityAlert(): void {
  try {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();

    const playTone = (frequency: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.value = frequency;

      // Ramp up quickly, hold, then ramp down
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.6, startTime + 0.05);
      gain.gain.setValueAtTime(0.6, startTime + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    // Two-tone alert pattern: high-low repeated twice
    playTone(880, now, 0.2);
    playTone(660, now + 0.25, 0.2);
    playTone(880, now + 0.55, 0.2);
    playTone(660, now + 0.80, 0.2);

    // Clean up after sounds finish
    setTimeout(() => ctx.close(), 2000);
  } catch {
    // Web Audio not available — fail silently
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AirplaneModeReminder({
  deliveryZoneBounds,
  stops,
  currentLocation,
}: AirplaneModeReminderProps) {
  const { t } = useLocale();
  const [dismissed, setDismissed] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [insideZone, setInsideZone] = useState(false);
  const [nearbyStopId, setNearbyStopId] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  /** Set of stop IDs that have already triggered an audio alert this session. */
  const alertedStopsRef = useRef<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Zone-level proximity (bounding box) — uses its own geolocation watcher
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!deliveryZoneBounds) return;
    if (!("geolocation" in navigator)) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        const near = isNearBounds(
          latitude,
          longitude,
          deliveryZoneBounds,
          1, // 1 km buffer
        );
        const inside = isInsideBounds(
          latitude,
          longitude,
          deliveryZoneBounds,
        );

        if (near && !dismissed) {
          setShowBanner(true);
        }

        setInsideZone(inside);
      },
      () => {
        // Geolocation errors are non-fatal for this feature
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000,
      },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [deliveryZoneBounds, dismissed]);

  // -------------------------------------------------------------------------
  // Stop-level proximity — uses currentLocation from parent (no extra watcher)
  // -------------------------------------------------------------------------
  const checkStopProximity = useCallback(() => {
    if (!currentLocation || !stops?.length) {
      setNearbyStopId(null);
      return;
    }

    for (const stop of stops) {
      // Only alert for non-delivered stops
      if (stop.status === "delivered") continue;

      const dist = haversineMeters(
        currentLocation.lat,
        currentLocation.lng,
        stop.lat,
        stop.lng,
      );

      if (dist <= STOP_ALERT_RADIUS_M) {
        setNearbyStopId(stop.deliveryId);

        if (!alertedStopsRef.current.has(stop.deliveryId)) {
          alertedStopsRef.current.add(stop.deliveryId);
          playProximityAlert();
        }
        return;
      }
    }

    setNearbyStopId(null);
  }, [currentLocation, stops]);

  useEffect(() => {
    checkStopProximity();
  }, [checkStopProximity]);

  const handleDismiss = () => {
    setDismissed(true);
    setShowBanner(false);
  };

  // Nothing to render if no bounds provided
  if (!deliveryZoneBounds) return null;

  return (
    <>
      {/* Per-stop proximity alert banner */}
      {nearbyStopId && (
        <div
          style={{
            backgroundColor: "var(--color-danger-light, #fee2e2)",
            borderBottom: "2px solid var(--color-danger, #dc2626)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            animation: "slide-up 0.2s ease",
          }}
        >
          {/* Volume/alert icon */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, color: "var(--color-danger, #dc2626)" }}
            aria-hidden="true"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
          <span
            style={{
              flex: 1,
              fontSize: 15,
              fontWeight: 700,
              color: "var(--color-danger, #dc2626)",
              lineHeight: 1.4,
            }}
          >
            {t('driver.airplaneMode.stopAlert')}
          </span>
        </div>
      )}

      {/* Zone-level proximity banner */}
      {showBanner && !dismissed && !nearbyStopId && (
        <div
          style={{
            backgroundColor: "var(--color-warning-bg)",
            borderBottom: "1px solid var(--color-warning-border)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            animation: "slide-up 0.2s ease",
          }}
        >
          {/* Airplane icon */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, color: "var(--color-warning-text)" }}
            aria-hidden="true"
          >
            <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
          </svg>

          <span
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-warning-text)",
              lineHeight: 1.4,
            }}
          >
            {t('driver.airplaneMode.approaching')}
          </span>

          <button
            onClick={handleDismiss}
            aria-label="Dismiss airplane mode reminder"
            style={{
              flexShrink: 0,
              background: "none",
              border: "none",
              padding: "4px 8px",
              fontSize: 18,
              fontWeight: 700,
              color: "var(--color-warning-text)",
              cursor: "pointer",
              minWidth: 36,
              minHeight: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Subtle in-zone indicator */}
      {insideZone && !nearbyStopId && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "6px 16px",
            backgroundColor: "var(--color-primary-light)",
            flexShrink: 0,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--color-primary)" }}
            aria-hidden="true"
          >
            <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
          </svg>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-primary)",
            }}
          >
            {t('driver.airplaneMode.recommended')}
          </span>
        </div>
      )}
    </>
  );
}
