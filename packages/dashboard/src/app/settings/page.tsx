"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { apiGet, apiPut, apiPost } from "@/lib/api";

const SettingsMap = dynamic(() => import("@/components/settings-map"), {
  ssr: false,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceArea {
  lat: number;
  lng: number;
  zoom: number;
  label: string;
}

interface OrgSettings {
  orgName: string;
  serviceArea: ServiceArea;
}

interface GeocodingResult {
  displayName: string;
  lat: number;
  lng: number;
  type: string;
  importance: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: OrgSettings = {
  orgName: "",
  serviceArea: {
    lat: 39.8283,
    lng: -98.5795,
    zoom: 12,
    label: "",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [orgName, setOrgName] = useState(DEFAULT_SETTINGS.orgName);
  const [lat, setLat] = useState(DEFAULT_SETTINGS.serviceArea.lat);
  const [lng, setLng] = useState(DEFAULT_SETTINGS.serviceArea.lng);
  const [zoom, setZoom] = useState(DEFAULT_SETTINGS.serviceArea.zoom);
  const [label, setLabel] = useState(DEFAULT_SETTINGS.serviceArea.label);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Load settings on mount
  useEffect(() => {
    async function fetchSettings() {
      const res = await apiGet<OrgSettings | null>("/api/settings");
      if (res.ok && res.data) {
        setOrgName(res.data.orgName);
        setLat(res.data.serviceArea.lat);
        setLng(res.data.serviceArea.lng);
        setZoom(res.data.serviceArea.zoom);
        setLabel(res.data.serviceArea.label);
      }
      setLoading(false);
    }
    fetchSettings();
  }, []);

  // Debounced geocode search
  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await apiPost<GeocodingResult[]>("/api/geocode/search", {
        query: value,
        limit: 5,
      });
      if (res.ok && Array.isArray(res.data)) {
        setSearchResults(res.data);
        setShowResults(true);
      }
      setSearching(false);
    }, 500);
  }, []);

  // Select a search result
  function handleSelectResult(result: GeocodingResult) {
    setLat(result.lat);
    setLng(result.lng);
    setLabel(result.displayName);
    setSearchQuery(result.displayName);
    setShowResults(false);
  }

  // Map click handler
  function handleMapClick(clickLat: number, clickLng: number) {
    setLat(clickLat);
    setLng(clickLng);
    setLabel(`${clickLat.toFixed(4)}, ${clickLng.toFixed(4)}`);
  }

  // Save settings
  async function handleSave() {
    setSaving(true);
    setSaved(false);

    const settings: OrgSettings = {
      orgName,
      serviceArea: { lat, lng, zoom, label },
    };

    const res = await apiPut("/api/settings", settings);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  // Close search results on outside click
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

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-8">Settings</h1>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your organization and default service area.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Org Name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Organization</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization Name</label>
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g., Chicago Mutual Aid"
                className="max-w-md"
              />
            </div>
          </CardContent>
        </Card>

        {/* Service Area */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Service Area</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set the default map center for all maps in the dashboard. Search
              for a city or click on the map to set the center point.
            </p>

            {/* Search input */}
            <div className="relative z-[10000]" ref={resultsRef}>
              <label className="text-sm font-medium">Search Location</label>
              <div className="relative mt-1">
                <Input
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() =>
                    searchResults.length > 0 && setShowResults(true)
                  }
                  placeholder="Search for a city or address..."
                />
                {searching && (
                  <div className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                )}

                {showResults && searchResults.length > 0 && (
                  <div className="absolute z-[10001] mt-1 w-full rounded-md border bg-card text-card-foreground shadow-xl max-h-60 overflow-y-auto">
                    {searchResults.map((result, i) => (
                      <button
                        key={i}
                        onClick={() => handleSelectResult(result)}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors border-b last:border-0"
                      >
                        <p className="font-medium leading-snug">
                          {result.displayName}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {result.type}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Map */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Map Center</label>
              <SettingsMap
                lat={lat}
                lng={lng}
                zoom={zoom}
                onLocationChange={handleMapClick}
              />
            </div>

            {/* Zoom */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Default Zoom Level: {zoom}
              </label>
              <div className="flex items-center gap-3 max-w-md">
                <span className="text-xs text-muted-foreground">10</span>
                <input
                  type="range"
                  min={10}
                  max={16}
                  step={1}
                  value={zoom}
                  onChange={(e) => setZoom(parseInt(e.target.value, 10))}
                  className="flex-1 accent-primary"
                />
                <span className="text-xs text-muted-foreground">16</span>
              </div>
            </div>

            {/* Coordinates display */}
            <div className="rounded-md border bg-muted/50 px-4 py-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Latitude:</span>{" "}
                  <span className="font-mono">{lat.toFixed(6)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Longitude:</span>{" "}
                  <span className="font-mono">{lng.toFixed(6)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Label:</span>{" "}
                  <span>{label || "Not set"}</span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={saving || !orgName.trim()}
              >
                {saving ? "Saving..." : "Save Settings"}
              </Button>
              {saved && (
                <span className="text-sm text-emerald-600 font-medium">
                  Settings saved successfully.
                </span>
              )}
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
