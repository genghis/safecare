"use client";

import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";
import { resolveDashboardTileUrlTemplate } from "@/lib/api-base";

export interface SettingsMapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface SettingsMapProps {
  lat: number;
  lng: number;
  zoom: number;
  onBoundsChange: (bounds: SettingsMapBounds, zoom: number, center: { lat: number; lng: number }) => void;
  onTileError?: () => void;
}

function emitBounds(
  map: ReturnType<typeof useMap>,
  onBoundsChange: (bounds: SettingsMapBounds, zoom: number, center: { lat: number; lng: number }) => void,
) {
  const b = map.getBounds();
  const c = map.getCenter();
  onBoundsChange(
    { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
    map.getZoom(),
    { lat: c.lat, lng: c.lng },
  );
}

function BoundsTracker({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: SettingsMapBounds, zoom: number, center: { lat: number; lng: number }) => void;
}) {
  const map = useMapEvents({
    moveend() {
      emitBounds(map, onBoundsChange);
    },
  });

  // Seed bounds immediately on mount so the parent's `bounds` state is non-null
  // even if the user never pans/zooms. Without this, the gating button on the
  // setup wizard stays disabled until the first moveend, which is a common
  // "stuck at the map step" trap when tiles are blank on a fresh install.
  useEffect(() => {
    emitBounds(map, onBoundsChange);
  }, [map, onBoundsChange]);

  return null;
}

function RecenterMap({
  lat,
  lng,
  zoom,
  onBoundsChange,
}: {
  lat: number;
  lng: number;
  zoom: number;
  onBoundsChange: (bounds: SettingsMapBounds, zoom: number, center: { lat: number; lng: number }) => void;
}) {
  const map = useMap();

  useEffect(() => {
    map.setView([lat, lng], zoom, { animate: true });
    // Emit bounds synchronously too — setView fires moveend on real moves,
    // but a no-op (same view) won't, leaving stale bounds.
    emitBounds(map, onBoundsChange);
  }, [lat, lng, zoom, map, onBoundsChange]);

  return null;
}

export default function SettingsMap({
  lat,
  lng,
  zoom,
  onBoundsChange,
  onTileError,
}: SettingsMapProps) {
  const tileUrlTemplate = resolveDashboardTileUrlTemplate();

  return (
    <div className="relative w-full h-[400px] rounded-md overflow-hidden">
      <MapContainer
        center={[lat, lng]}
        zoom={zoom}
        className="w-full h-full"
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution="SafeCare tile cache"
          url={tileUrlTemplate}
          eventHandlers={onTileError ? { tileerror: () => onTileError() } : undefined}
        />
        <BoundsTracker onBoundsChange={onBoundsChange} />
        <RecenterMap lat={lat} lng={lng} zoom={zoom} onBoundsChange={onBoundsChange} />
      </MapContainer>

      {/* Viewport border to show "this is the selection" */}
      <div className="absolute inset-0 pointer-events-none border-4 border-primary/40 rounded-md z-[500]" />

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] bg-background/80 backdrop-blur-sm text-xs px-3 py-1.5 rounded-md border shadow-sm pointer-events-none">
        Pan and zoom so the visible area covers your full operating region
      </div>
    </div>
  );
}
