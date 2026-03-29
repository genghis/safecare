"use client";

import L from "leaflet";
import { MapContainer, TileLayer, useMapEvents, useMap } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

// Fix default marker icons
if (typeof window !== "undefined") {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

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
}

function BoundsTracker({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: SettingsMapBounds, zoom: number, center: { lat: number; lng: number }) => void;
}) {
  const map = useMapEvents({
    moveend() {
      const b = map.getBounds();
      const c = map.getCenter();
      onBoundsChange(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        map.getZoom(),
        { lat: c.lat, lng: c.lng },
      );
    },
  });
  return null;
}

function RecenterMap({
  lat,
  lng,
  zoom,
}: {
  lat: number;
  lng: number;
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.setView([lat, lng], zoom, { animate: true });
  }, [lat, lng, zoom, map]);

  return null;
}

export default function SettingsMap({
  lat,
  lng,
  zoom,
  onBoundsChange,
}: SettingsMapProps) {
  return (
    <div className="relative w-full h-[400px] rounded-md overflow-hidden">
      <MapContainer
        center={[lat, lng]}
        zoom={zoom}
        className="w-full h-full"
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BoundsTracker onBoundsChange={onBoundsChange} />
        <RecenterMap lat={lat} lng={lng} zoom={zoom} />
      </MapContainer>

      {/* Viewport border to show "this is the selection" */}
      <div className="absolute inset-0 pointer-events-none border-4 border-primary/40 rounded-md z-[500]" />

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] bg-background/80 backdrop-blur-sm text-xs px-3 py-1.5 rounded-md border shadow-sm pointer-events-none">
        Pan and zoom so the visible area covers your full operating region
      </div>
    </div>
  );
}
