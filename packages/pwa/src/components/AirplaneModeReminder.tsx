/**
 * Airplane mode reminder component.
 *
 * Watches the driver's GPS position and shows a dismissible banner when
 * they approach or enter the delivery zone bounding box. The reminder
 * only fires once per session to avoid being annoying.
 */

import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AirplaneModeReminderProps {
  deliveryZoneBounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  } | null;
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AirplaneModeReminder({
  deliveryZoneBounds,
}: AirplaneModeReminderProps) {
  const [dismissed, setDismissed] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [insideZone, setInsideZone] = useState(false);
  const watchIdRef = useRef<number | null>(null);

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

  const handleDismiss = () => {
    setDismissed(true);
    setShowBanner(false);
  };

  // Nothing to render if no bounds provided
  if (!deliveryZoneBounds) return null;

  return (
    <>
      {/* Proximity banner */}
      {showBanner && !dismissed && (
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
            You are approaching the delivery area. Consider enabling airplane
            mode for privacy.
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
      {insideZone && (
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
            Airplane mode recommended
          </span>
        </div>
      )}
    </>
  );
}
