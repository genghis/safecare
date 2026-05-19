"use client";

import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";
import { useEffect, useRef } from "react";
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
  // Override the tile URL template + subdomains + attribution. Used by the
  // setup wizard to render public OpenStreetMap tiles before the local
  // SafeCare tile cache has been provisioned (without this, the wizard's
  // map is a useless gray box).
  tileUrlOverride?: string;
  tileSubdomainsOverride?: string;
  tileAttributionOverride?: string;
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
  // Hold the latest callback in a ref so effects don't re-run when callers
  // pass a fresh inline function each render (which would cause an infinite
  // setState loop via emitBounds → parent setState → new ref → effect refire).
  const cbRef = useRef(onBoundsChange);
  useEffect(() => {
    cbRef.current = onBoundsChange;
  }, [onBoundsChange]);

  const map = useMapEvents({
    moveend() {
      emitBounds(map, cbRef.current);
    },
  });

  // Seed bounds immediately on mount so the parent's `bounds` state is non-null
  // even if the user never pans/zooms. Without this, the gating button on the
  // setup wizard stays disabled until the first moveend, which is a common
  // "stuck at the map step" trap when tiles are blank on a fresh install.
  useEffect(() => {
    emitBounds(map, cbRef.current);
  }, [map]);

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

  const cbRef = useRef(onBoundsChange);
  useEffect(() => {
    cbRef.current = onBoundsChange;
  }, [onBoundsChange]);

  useEffect(() => {
    map.setView([lat, lng], zoom, { animate: true });
    // Emit bounds synchronously too — setView fires moveend on real moves,
    // but a no-op (same view) won't, leaving stale bounds.
    emitBounds(map, cbRef.current);
  }, [lat, lng, zoom, map]);

  return null;
}

export default function SettingsMap({
  lat,
  lng,
  zoom,
  onBoundsChange,
  onTileError,
  tileUrlOverride,
  tileSubdomainsOverride,
  tileAttributionOverride,
}: SettingsMapProps) {
  const tileUrlTemplate = tileUrlOverride ?? resolveDashboardTileUrlTemplate();
  const attribution = tileAttributionOverride ?? "SafeCare tile cache";

  return (
    <div className="relative w-full h-[400px] rounded-md overflow-hidden">
      <MapContainer
        center={[lat, lng]}
        zoom={zoom}
        className="w-full h-full"
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution={attribution}
          url={tileUrlTemplate}
          subdomains={tileSubdomainsOverride ?? "abc"}
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
