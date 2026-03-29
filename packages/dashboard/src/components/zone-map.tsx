"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Marker,
  useMapEvents,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

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

export interface ZoneMapProps {
  zones: Zone[];
  editingPoints: ZonePoint[];
  editingColor: string;
  onAddPoint: (lat: number, lng: number) => void;
  onUpdatePoints: (points: ZonePoint[]) => void;
  defaultCenter?: { lat: number; lng: number; zoom: number };
}

// ---------------------------------------------------------------------------
// Fix default marker icon paths (Leaflet + bundler issue)
// Must be inside a check so Next.js build doesn't blow up.
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

// ---------------------------------------------------------------------------
// Small draggable marker icon for polygon vertices
// ---------------------------------------------------------------------------

function makeVertexIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};border:2px solid #fff;
      box-shadow:0 0 4px rgba(0,0,0,.4);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// ---------------------------------------------------------------------------
// ClickHandler -- adds a point when the map is clicked
// ---------------------------------------------------------------------------

function ClickHandler({ onAddPoint }: { onAddPoint: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onAddPoint(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ---------------------------------------------------------------------------
// FitBounds -- auto-fit the map whenever zone data changes
// ---------------------------------------------------------------------------

function FitBounds({ zones, editingPoints }: { zones: Zone[]; editingPoints: ZonePoint[] }) {
  const map = useMap();

  useEffect(() => {
    const allPoints: L.LatLngExpression[] = [];

    zones.forEach((z) =>
      z.polygon.forEach((p) => allPoints.push([p.lat, p.lng]))
    );
    editingPoints.forEach((p) => allPoints.push([p.lat, p.lng]));

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
    // Only re-fit when zones change (not on every editing point add)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, map]);

  return null;
}

// ---------------------------------------------------------------------------
// DraggableVertex
// ---------------------------------------------------------------------------

function DraggableVertex({
  position,
  index,
  color,
  onDrag,
}: {
  position: ZonePoint;
  index: number;
  color: string;
  onDrag: (index: number, lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  const icon = useMemo(() => makeVertexIcon(color), [color]);

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker) {
          const latlng = marker.getLatLng();
          onDrag(index, latlng.lat, latlng.lng);
        }
      },
    }),
    [index, onDrag]
  );

  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={icon}
      draggable
      eventHandlers={eventHandlers}
      ref={markerRef}
    />
  );
}

// ---------------------------------------------------------------------------
// ZoneMap (default export for dynamic import)
// ---------------------------------------------------------------------------

export default function ZoneMap({
  zones,
  editingPoints,
  editingColor,
  onAddPoint,
  onUpdatePoints,
  defaultCenter,
}: ZoneMapProps) {
  function handleVertexDrag(index: number, lat: number, lng: number) {
    const updated = editingPoints.map((p, i) =>
      i === index ? { lat, lng } : p
    );
    onUpdatePoints(updated);
  }

  const editingLatLngs: L.LatLngExpression[] = editingPoints.map((p) => [
    p.lat,
    p.lng,
  ]);

  return (
    <div className="relative w-full h-[400px] rounded-md border overflow-hidden">
      <MapContainer
        center={defaultCenter ? [defaultCenter.lat, defaultCenter.lng] : [39.8283, -98.5795]}
        zoom={defaultCenter ? defaultCenter.zoom : 4}
        className="w-full h-full"
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onAddPoint={onAddPoint} />
        <FitBounds zones={zones} editingPoints={editingPoints} />

        {/* Render existing zones as colored polygons */}
        {zones.map((zone) => (
          <Polygon
            key={zone.id}
            positions={zone.polygon.map((p) => [p.lat, p.lng] as L.LatLngExpression)}
            pathOptions={{
              color: zone.color,
              fillColor: zone.color,
              fillOpacity: 0.2,
              weight: 2,
            }}
          />
        ))}

        {/* Render the editing polygon */}
        {editingLatLngs.length >= 2 && (
          <Polygon
            positions={editingLatLngs}
            pathOptions={{
              color: editingColor,
              fillColor: editingColor,
              fillOpacity: 0.15,
              weight: 2,
              dashArray: "8 4",
            }}
          />
        )}

        {/* Draggable vertex markers for editing points */}
        {editingPoints.map((pt, i) => (
          <DraggableVertex
            key={i}
            position={pt}
            index={i}
            color={editingColor}
            onDrag={handleVertexDrag}
          />
        ))}
      </MapContainer>

      {/* Instruction overlay */}
      <div className="absolute top-2 left-12 z-[1000] bg-background/80 backdrop-blur-sm text-xs px-3 py-1.5 rounded-md border shadow-sm pointer-events-none">
        Click on the map to add polygon points. Drag markers to adjust.
      </div>
    </div>
  );
}
