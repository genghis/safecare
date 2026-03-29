"use client";

import { useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
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

interface SettingsMapProps {
  lat: number;
  lng: number;
  zoom: number;
  onLocationChange: (lat: number, lng: number) => void;
}

function makeCenterIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:24px;height:24px;border-radius:50%;
      background:#3b82f6;border:3px solid #fff;
      box-shadow:0 0 8px rgba(0,0,0,.4);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterMap({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();

  useEffect(() => {
    map.setView([lat, lng], zoom, { animate: true });
  }, [lat, lng, zoom, map]);

  return null;
}

export default function SettingsMap({ lat, lng, zoom, onLocationChange }: SettingsMapProps) {
  const icon = useMemo(() => makeCenterIcon(), []);

  return (
    <div className="relative w-full h-[400px] rounded-md border overflow-hidden">
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
        <ClickHandler onMapClick={(clickLat, clickLng) => onLocationChange(clickLat, clickLng)} />
        <RecenterMap lat={lat} lng={lng} zoom={zoom} />
        <Marker position={[lat, lng]} icon={icon} />
      </MapContainer>

      <div className="absolute top-2 left-12 z-[1000] bg-background/80 backdrop-blur-sm text-xs px-3 py-1.5 rounded-md border shadow-sm pointer-events-none">
        Click the map to set the service area center.
      </div>
    </div>
  );
}
