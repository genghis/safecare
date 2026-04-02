"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Polygon, Marker, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { apiPost } from "@/lib/api";
import { resolveDashboardTileUrlTemplate } from "@/lib/api-base";

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
}

interface GeocodingResult {
  displayName: string;
  lat: number;
  lng: number;
  type: string;
  importance: number;
}

export interface AddressPickerMapProps {
  lat: number | null;
  lng: number | null;
  address: string;
  onLocationChange: (lat: number, lng: number, address: string) => void;
  onAddressChange: (address: string) => void;
  zones?: Zone[];
  defaultCenter?: { lat: number; lng: number; zoom: number };
}

// ---------------------------------------------------------------------------
// Pin icon
// ---------------------------------------------------------------------------

function makePinIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:20px;height:20px;border-radius:50%;
      background:#ef4444;border:3px solid #fff;
      box-shadow:0 0 6px rgba(0,0,0,.4);
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// ---------------------------------------------------------------------------
// ClickHandler
// ---------------------------------------------------------------------------

function ClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ---------------------------------------------------------------------------
// FitToPoint
// ---------------------------------------------------------------------------

function FitToPoint({
  lat,
  lng,
}: {
  lat: number | null;
  lng: number | null;
}) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (lat !== null && lng !== null && !fittedRef.current) {
      map.setView([lat, lng], 15);
      fittedRef.current = true;
    }
  }, [lat, lng, map]);

  return null;
}

// ---------------------------------------------------------------------------
// FlyToPoint -- animate to search result
// ---------------------------------------------------------------------------

function FlyToPoint({
  lat,
  lng,
  trigger,
}: {
  lat: number | null;
  lng: number | null;
  trigger: number;
}) {
  const map = useMap();
  const lastTrigger = useRef(0);

  useEffect(() => {
    if (lat !== null && lng !== null && trigger > lastTrigger.current) {
      map.flyTo([lat, lng], 16, { duration: 0.5 });
      lastTrigger.current = trigger;
    }
  }, [lat, lng, trigger, map]);

  return null;
}

// ---------------------------------------------------------------------------
// AddressPickerMap
// ---------------------------------------------------------------------------

export default function AddressPickerMap({
  lat,
  lng,
  address,
  onLocationChange,
  onAddressChange,
  zones = [],
  defaultCenter,
}: AddressPickerMapProps) {
  const tileUrlTemplate = resolveDashboardTileUrlTemplate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const [flyTrigger, setFlyTrigger] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<L.Marker>(null);
  const pinIcon = useMemo(() => makePinIcon(), []);

  // Debounced search
  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (value.length < 3) {
        setSearchResults([]);
        setShowResults(false);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        // Build viewbox from defaultCenter to bias results toward service area
        // Nominatim viewbox format: "west,south,east,north" (~0.5 degree box)
        const searchBody: Record<string, unknown> = { query: value, limit: 5 };
        if (defaultCenter) {
          const pad = 0.5;
          searchBody.viewbox = `${defaultCenter.lng - pad},${defaultCenter.lat - pad},${defaultCenter.lng + pad},${defaultCenter.lat + pad}`;
        }
        const res = await apiPost<GeocodingResult[]>("/api/geocode/search", searchBody);
        if (res.ok && Array.isArray(res.data)) {
          setSearchResults(res.data);
          setShowResults(true);
        }
        setSearching(false);
      }, 500);
    },
    [defaultCenter]
  );

  // Reverse geocode on pin placement
  const reverseGeocode = useCallback(
    async (newLat: number, newLng: number) => {
      const res = await apiPost<{ displayName: string }>(
        "/api/geocode/reverse",
        { lat: newLat, lng: newLng }
      );
      if (res.ok && res.data?.displayName) {
        onLocationChange(newLat, newLng, res.data.displayName);
        onAddressChange(res.data.displayName);
      } else {
        onLocationChange(newLat, newLng, address);
      }
    },
    [address, onLocationChange, onAddressChange]
  );

  // Map click handler
  function handleMapClick(clickLat: number, clickLng: number) {
    reverseGeocode(clickLat, clickLng);
  }

  // Search result selection
  function handleSelectResult(result: GeocodingResult) {
    onLocationChange(result.lat, result.lng, result.displayName);
    onAddressChange(result.displayName);
    setSearchQuery(result.displayName);
    setShowResults(false);
    setFlyTrigger((t) => t + 1);
  }

  // Marker drag end
  const markerEventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker) {
          const latlng = marker.getLatLng();
          reverseGeocode(latlng.lat, latlng.lng);
        }
      },
    }),
    [reverseGeocode]
  );

  // Close results on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(e.target as Node)
      ) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="space-y-2">
      {/* Search input — z-index must beat Leaflet's internal z-indices */}
      <div className="relative z-[10000]" ref={resultsRef}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchInput(e.target.value)}
          onFocus={() => searchResults.length > 0 && setShowResults(true)}
          placeholder="Search for an address..."
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {searching && (
          <div className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        )}

        {/* Results dropdown */}
        {showResults && searchResults.length > 0 && (
          <div className="absolute z-[10001] mt-1 w-full rounded-md border bg-card text-card-foreground shadow-xl max-h-60 overflow-y-auto">
            {searchResults.map((result, i) => (
              <button
                key={i}
                onClick={() => handleSelectResult(result)}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors border-b last:border-0"
              >
                <p className="font-medium leading-snug">{result.displayName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{result.type}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="relative w-full h-[300px] rounded-md border overflow-hidden">
        <MapContainer
          center={defaultCenter ? [defaultCenter.lat, defaultCenter.lng] : [39.8283, -98.5795]}
          zoom={defaultCenter ? defaultCenter.zoom : 4}
          className="w-full h-full"
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer attribution="SafeCare tile cache" url={tileUrlTemplate} />
          <ClickHandler onMapClick={handleMapClick} />
          <FitToPoint lat={lat} lng={lng} />
          <FlyToPoint lat={lat} lng={lng} trigger={flyTrigger} />

          {/* Zone overlays */}
          {zones.map((zone) => (
            <Polygon
              key={zone.id}
              positions={zone.polygon.map(
                (p) => [p.lat, p.lng] as L.LatLngExpression
              )}
              pathOptions={{
                color: zone.color,
                fillColor: zone.color,
                fillOpacity: 0.15,
                weight: 2,
              }}
            />
          ))}

          {/* Pin marker */}
          {lat !== null && lng !== null && (
            <Marker
              position={[lat, lng]}
              icon={pinIcon}
              draggable
              eventHandlers={markerEventHandlers}
              ref={markerRef}
            />
          )}
        </MapContainer>
        {lat === null && (
          <div className="absolute top-2 left-12 z-[1000] bg-background/80 backdrop-blur-sm text-xs px-3 py-1.5 rounded-md border shadow-sm pointer-events-none">
            Search above or click the map to set the delivery location.
          </div>
        )}
      </div>

      {/* Coordinates display */}
      {lat !== null && lng !== null && (
        <p className="text-xs text-muted-foreground font-mono">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </p>
      )}
    </div>
  );
}
