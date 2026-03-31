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
import { useLocale } from "@/lib/locale";

// ---------------------------------------------------------------------------
// Two-Factor Authentication Section
// ---------------------------------------------------------------------------

function TwoFactorSection() {
  const { t } = useLocale();
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Setup flow state
  const [setupSecret, setSetupSecret] = useState("");
  const [setupUri, setSetupUri] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [enabling, setEnabling] = useState(false);
  const [setupError, setSetupError] = useState("");

  // Disable flow state
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState("");

  useEffect(() => {
    async function fetchStatus() {
      const res = await apiGet<{ enabled: boolean }>(
        "/api/auth/admin/totp/status",
      );
      if (res.ok) {
        setTotpEnabled(res.data.enabled);
      }
      setLoading(false);
    }
    fetchStatus();
  }, []);

  async function handleStartSetup() {
    setSetupError("");
    const res = await apiPost<{ secret: string; uri: string }>(
      "/api/auth/admin/totp/setup", {},
    );
    if (res.ok && res.data) {
      setSetupSecret(res.data.secret);
      setSetupUri(res.data.uri);
      setShowSetup(true);
    } else {
      setSetupError(res.error || t('dashboard.settings.totpSetupFailed'));
    }
  }

  async function handleVerifyAndEnable(e: React.FormEvent) {
    e.preventDefault();
    setSetupError("");
    setEnabling(true);

    const res = await apiPost<{ enabled: boolean }>(
      "/api/auth/admin/totp/enable",
      { secret: setupSecret, token: verifyCode },
    );

    if (res.ok && res.data?.enabled) {
      setTotpEnabled(true);
      setShowSetup(false);
      setVerifyCode("");
      setSetupSecret("");
      setSetupUri("");
    } else {
      setSetupError(res.error || t('dashboard.settings.invalidCode'));
    }

    setEnabling(false);
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setDisableError("");
    setDisabling(true);

    const res = await apiPost<{ enabled: boolean }>(
      "/api/auth/admin/totp/disable",
      { password: disablePassword },
    );

    if (res.ok) {
      setTotpEnabled(false);
      setShowDisable(false);
      setDisablePassword("");
    } else {
      setDisableError(res.error || t('dashboard.settings.invalidPassword'));
    }

    setDisabling(false);
  }

  if (loading || totpEnabled === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('dashboard.settings.2fa')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('dashboard.common.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {t('dashboard.settings.2fa')}
          {totpEnabled && (
            <span className="text-emerald-600 text-sm font-normal">
              &#10003; {t('dashboard.common.enabled')}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('dashboard.settings.2faDesc')}
        </p>

        {!totpEnabled && !showSetup && (
          <>
            {setupError && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                {setupError}
              </div>
            )}
            <Button onClick={handleStartSetup}>{t('dashboard.settings.enable2fa')}</Button>
          </>
        )}

        {!totpEnabled && showSetup && (
          <div className="space-y-4 rounded-md border p-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t('dashboard.settings.2faScanPrompt')}
              </p>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-muted-foreground">
                    {t('dashboard.settings.otpAuthUri')}
                  </label>
                  <div className="mt-1 rounded-md bg-muted p-2 text-xs font-mono break-all select-all">
                    {setupUri}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">
                    {t('dashboard.settings.secretManualEntry')}
                  </label>
                  <div className="mt-1 rounded-md bg-muted p-2 text-sm font-mono tracking-wider select-all">
                    {setupSecret}
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={handleVerifyAndEnable} className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t('dashboard.settings.2faVerifyPrompt')}
                </p>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) =>
                    setVerifyCode(
                      e.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                  className="max-w-[200px] text-center text-lg tracking-widest font-mono"
                />
              </div>

              {setupError && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {setupError}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={enabling || verifyCode.length !== 6}
                >
                  {enabling ? t('dashboard.settings.verifying') : t('dashboard.settings.verifyAndEnable')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowSetup(false);
                    setVerifyCode("");
                    setSetupError("");
                  }}
                >
                  {t('dashboard.common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        )}

        {totpEnabled && !showDisable && (
          <div className="space-y-3">
            <p className="text-sm">
              {t('dashboard.settings.2faProtected')}
            </p>
            <Button
              variant="outline"
              onClick={() => setShowDisable(true)}
            >
              {t('dashboard.settings.disable2fa')}
            </Button>
          </div>
        )}

        {totpEnabled && showDisable && (
          <form onSubmit={handleDisable} className="space-y-3">
            <p className="text-sm">
              {t('dashboard.settings.disableConfirmPrompt')}
            </p>
            <Input
              type="password"
              placeholder={t('dashboard.settings.enterPassword')}
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="max-w-md"
              required
            />

            {disableError && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                {disableError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="destructive"
                disabled={disabling || !disablePassword}
              >
                {disabling ? t('dashboard.settings.disabling') : t('dashboard.settings.disable2fa')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowDisable(false);
                  setDisablePassword("");
                  setDisableError("");
                }}
              >
                {t('dashboard.common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

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
  bounds?: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
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

interface ProvisionStatus {
  status: "not_started" | "downloading" | "importing" | "ready" | "error";
  progress?: number;
  state?: string;
  sizeBytes?: number;
  downloadedBytes?: number;
  message?: string;
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
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [orgName, setOrgName] = useState(DEFAULT_SETTINGS.orgName);
  const [lat, setLat] = useState(DEFAULT_SETTINGS.serviceArea.lat);
  const [lng, setLng] = useState(DEFAULT_SETTINGS.serviceArea.lng);
  const [zoom, setZoom] = useState(DEFAULT_SETTINGS.serviceArea.zoom);
  const [label, setLabel] = useState(DEFAULT_SETTINGS.serviceArea.label);
  const [bounds, setBounds] = useState<{ south: number; west: number; north: number; east: number } | undefined>(undefined);

  // Provision status
  const [provisionStatus, setProvisionStatus] = useState<ProvisionStatus>({
    status: "not_started",
  });
  const [provisioning, setProvisioning] = useState(false);

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
        if (res.data.serviceArea.bounds) {
          setBounds(res.data.serviceArea.bounds);
        }
      }
      setLoading(false);
    }
    fetchSettings();
  }, []);

  // Poll provision status on mount and every 5 seconds
  useEffect(() => {
    let active = true;

    async function fetchStatus() {
      const res = await apiGet<ProvisionStatus>("/api/settings/provision-status");
      if (res.ok && active) {
        setProvisionStatus(res.data);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Provision maps handler -- immediate feedback on click
  async function handleProvision() {
    setProvisioning(true);
    setProvisionStatus({
      status: "downloading",
      message: "Connecting to download server...",
    });
    const res = await apiPost("/api/settings/provision-maps", {});
    if (!res.ok) {
      setProvisionStatus({
        status: "error",
        message: res.error || "Failed to start provisioning.",
      });
    }
    setProvisioning(false);
  }

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

  // Select a search result — recenters the map on that location
  function handleSelectResult(result: GeocodingResult) {
    setLat(result.lat);
    setLng(result.lng);
    setZoom(13);
    setLabel(result.displayName);
    setSearchQuery(result.displayName);
    setShowResults(false);
  }

  // Save settings
  async function handleSave() {
    setSaving(true);
    setSaved(false);

    const settings: OrgSettings = {
      orgName,
      serviceArea: { lat, lng, zoom, label, bounds },
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
        <h1 className="text-3xl font-bold tracking-tight mb-8">{t('dashboard.settings.title')}</h1>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          {t('dashboard.settings.loadingSettings')}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.settings.title')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('dashboard.settings.subtitle')}
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Org Name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('dashboard.settings.organization')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dashboard.settings.orgName')}</label>
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder={t('dashboard.settings.orgNamePlaceholder')}
                className="max-w-md"
              />
            </div>
          </CardContent>
        </Card>

        {/* Operating Region */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('dashboard.settings.operatingRegion')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('dashboard.settings.operatingRegionDesc')}
            </p>

            {/* Search input */}
            <div className="relative z-[10000]" ref={resultsRef}>
              <label className="text-sm font-medium">{t('dashboard.settings.searchLocation')}</label>
              <div className="relative mt-1">
                <Input
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() =>
                    searchResults.length > 0 && setShowResults(true)
                  }
                  placeholder={t('dashboard.settings.searchPlaceholder')}
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
              <SettingsMap
                lat={lat}
                lng={lng}
                zoom={zoom}
                onBoundsChange={(newBounds, newZoom, center) => {
                  setBounds(newBounds);
                  setZoom(newZoom);
                  setLat(center.lat);
                  setLng(center.lng);
                  if (!label || label.match(/^-?\d/)) {
                    setLabel(`${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);
                  }
                }}
              />
            </div>

            {/* Region info + size estimate */}
            {bounds && (() => {
              const areaSqDeg = (bounds.north - bounds.south) * (bounds.east - bounds.west);
              const estMB = Math.round(areaSqDeg * 40);
              const estRAM = Math.round(areaSqDeg * 80);
              const isLarge = estRAM > 1500;
              const isVeryLarge = estRAM > 3000;

              return (
                <div className="rounded-md border bg-muted/50 px-4 py-3 space-y-2">
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">{t('dashboard.settings.center')}</span>{" "}
                      <span className="font-mono">{label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t('dashboard.settings.estimatedSize')}</span>
                      <span className={`font-medium ${isVeryLarge ? "text-destructive" : isLarge ? "text-amber-500" : "text-emerald-600"}`}>
                        ~{estMB < 1 ? '<1' : estMB} MB download, ~{estRAM < 100 ? '<100' : estRAM} MB RAM
                      </span>
                    </div>
                  </div>
                  {isVeryLarge && (
                    <p className="text-xs text-destructive">{t('dashboard.settings.largeRegionWarning')}</p>
                  )}
                  {isLarge && !isVeryLarge && (
                    <p className="text-xs text-amber-500">{t('dashboard.settings.mediumRegionNote')}</p>
                  )}
                </div>
              );
            })()}
          </CardContent>
          <CardFooter>
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? t('dashboard.common.saving') : t('dashboard.settings.saveSettings')}
              </Button>
              {saved && (
                <span className="text-sm text-emerald-600 font-medium">
                  {t('dashboard.settings.settingsSaved')}
                </span>
              )}
            </div>
          </CardFooter>
        </Card>

        {/* Map Data Provisioning */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {t('dashboard.settings.mapData')}
              {provisionStatus.status === "ready" && (
                <span className="text-emerald-600 text-sm font-normal">
                  &#10003; {t('dashboard.common.ready')}
                </span>
              )}
              {provisionStatus.status === "error" && (
                <span className="text-destructive text-sm font-normal">
                  &#10007; {t('dashboard.common.error')}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {provisionStatus.status === "not_started" && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.settings.noMapData')}
                </p>
                <Button
                  onClick={handleProvision}
                  disabled={provisioning || !bounds}
                >
                  {provisioning ? t('dashboard.common.starting') : t('dashboard.settings.provisionMaps')}
                </Button>
              </>
            )}

            {provisionStatus.status === "downloading" && (
              <>
                <p className="text-sm text-muted-foreground">
                  {provisionStatus.message ||
                    `Downloading map data for ${provisionStatus.state}...`}
                </p>
                <div className="space-y-2">
                  <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{
                        width: `${provisionStatus.progress ?? 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{provisionStatus.progress ?? 0}%</span>
                    {provisionStatus.sizeBytes ? (
                      <span>
                        {((provisionStatus.downloadedBytes ?? 0) / 1024 / 1024).toFixed(0)} MB
                        {" / "}
                        {(provisionStatus.sizeBytes / 1024 / 1024).toFixed(0)} MB
                      </span>
                    ) : null}
                  </div>
                </div>
              </>
            )}

            {provisionStatus.status === "importing" && (
              <>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent flex-shrink-0" />
                    <span className="font-medium">
                      {provisionStatus.message || t('dashboard.settings.importingMaps')}
                    </span>
                  </div>
                  {(provisionStatus as any).importProgress != null && (
                    <div className="space-y-1">
                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-1000"
                          style={{ width: `${(provisionStatus as any).importProgress}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ~{(provisionStatus as any).importProgress}% complete
                        {(provisionStatus as any).elapsed && ` — ${(provisionStatus as any).elapsed} elapsed`}
                      </div>
                    </div>
                  )}
                  {!(provisionStatus as any).importProgress && (provisionStatus as any).elapsed && (
                    <p className="text-xs text-muted-foreground">
                      {(provisionStatus as any).elapsed} elapsed
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('dashboard.settings.importTimeEstimate')}
                  </p>
                </div>
              </>
            )}

            {provisionStatus.status === "ready" && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.settings.mapsReady')}
                </p>
                {provisionStatus.state && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t('dashboard.settings.state')}</span>{" "}
                    {provisionStatus.state}
                    {provisionStatus.sizeBytes
                      ? ` (${(provisionStatus.sizeBytes / 1024 / 1024).toFixed(0)} MB)`
                      : ""}
                  </p>
                )}
                <Button
                  variant="outline"
                  onClick={handleProvision}
                  disabled={provisioning}
                >
                  {provisioning ? t('dashboard.common.starting') : t('dashboard.settings.reprovision')}
                </Button>
              </>
            )}

            {provisionStatus.status === "error" && (
              <>
                <p className="text-sm text-destructive">
                  {provisionStatus.message || t('dashboard.common.error')}
                </p>
                <Button
                  variant="outline"
                  onClick={handleProvision}
                  disabled={provisioning}
                >
                  {provisioning ? t('dashboard.common.starting') : t('dashboard.common.retry')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Two-Factor Authentication */}
        <TwoFactorSection />
      </div>
    </div>
  );
}
