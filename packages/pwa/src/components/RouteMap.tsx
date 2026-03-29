/**
 * Offline-capable Leaflet map for the driver delivery route.
 *
 * Shows the driving route polyline, numbered stop markers, and the
 * driver's live GPS position. Tiles are served from the Cache API by the
 * service worker when offline.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteStop {
  deliveryId: string;
  address: string;
  lat: number;
  lng: number;
  recipientName: string;
  sequence: number;
  status?: string;
}

export interface RouteMapProps {
  stops: RouteStop[];
  routeGeometry?: { type: "LineString"; coordinates: [number, number][] };
  currentLocation?: { lat: number; lng: number } | null;
  onStopClick?: (deliveryId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a numbered circle DivIcon for a stop marker. */
function makeStopIcon(sequence: number, status?: string): L.DivIcon {
  const bg =
    status === "delivered"
      ? "#27ae60"
      : status === "in_transit"
        ? "#e67e22"
        : "#1a6b3c";

  return L.divIcon({
    className: "", // suppress default leaflet-div-icon styling
    html: `<div style="
      width:32px;height:32px;border-radius:50%;
      background:${bg};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:14px;
      border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.35);
    ">${sequence}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

/** Build a pulsing blue dot DivIcon for the driver's current location. */
function makeCurrentLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:#3b82f6;
      border:3px solid #fff;
      box-shadow:0 0 0 4px rgba(59,130,246,0.35), 0 2px 6px rgba(0,0,0,0.3);
      animation:pulse-dot 2s ease-in-out infinite;
    "></div>
    <style>
      @keyframes pulse-dot {
        0%,100%{box-shadow:0 0 0 4px rgba(59,130,246,0.35),0 2px 6px rgba(0,0,0,0.3)}
        50%{box-shadow:0 0 0 10px rgba(59,130,246,0.15),0 2px 6px rgba(0,0,0,0.3)}
      }
    </style>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RouteMap({
  stops,
  routeGeometry,
  currentLocation,
  onStopClick,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);
  const locationMarkerRef = useRef<L.Marker | null>(null);

  // Initialise the map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([39.8283, -98.5795], 4); // default US center

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: "anonymous",
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync stops and route geometry onto the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Clear previous polyline
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    // Draw route polyline (GeoJSON coordinates are [lng, lat])
    if (routeGeometry?.coordinates?.length) {
      const latLngs: L.LatLngExpression[] = routeGeometry.coordinates.map(
        ([lng, lat]) => [lat, lng] as [number, number],
      );

      polylineRef.current = L.polyline(latLngs, {
        color: "#3b82f6",
        weight: 4,
        opacity: 0.8,
      }).addTo(map);
    }

    // Add stop markers
    const bounds = L.latLngBounds([]);

    stops.forEach((stop) => {
      const marker = L.marker([stop.lat, stop.lng], {
        icon: makeStopIcon(stop.sequence, stop.status),
      }).addTo(map);

      marker.bindPopup(
        `<div style="font-family:sans-serif;padding:2px">
          <strong>#${stop.sequence} ${stop.recipientName}</strong><br/>
          <span style="font-size:13px;color:#666">${stop.address}</span>
        </div>`,
        { closeButton: false, maxWidth: 220 },
      );

      if (onStopClick) {
        marker.on("click", () => onStopClick(stop.deliveryId));
      }

      bounds.extend([stop.lat, stop.lng]);
      markersRef.current.push(marker);
    });

    // Include polyline in bounds
    if (polylineRef.current) {
      bounds.extend(polylineRef.current.getBounds());
    }

    // Fit bounds with padding
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
    }
  }, [stops, routeGeometry, onStopClick]);

  // Update driver location marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (currentLocation) {
      if (locationMarkerRef.current) {
        locationMarkerRef.current.setLatLng([
          currentLocation.lat,
          currentLocation.lng,
        ]);
      } else {
        locationMarkerRef.current = L.marker(
          [currentLocation.lat, currentLocation.lng],
          { icon: makeCurrentLocationIcon(), zIndexOffset: 1000 },
        ).addTo(map);
      }
    } else if (locationMarkerRef.current) {
      locationMarkerRef.current.remove();
      locationMarkerRef.current = null;
    }
  }, [currentLocation]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: 280,
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        border: "1px solid var(--color-border)",
      }}
    />
  );
}
