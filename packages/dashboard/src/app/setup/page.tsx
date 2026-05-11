"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
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
import { apiPost, apiPut, apiGet, setToken, getToken } from "@/lib/api";
import { useLocale } from "@/lib/locale";

const SettingsMap = dynamic(() => import("@/components/settings-map"), {
  ssr: false,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeocodingResult {
  displayName: string;
  lat: number;
  lng: number;
  type: string;
}

interface ProvisionStatus {
  status: string;
  message?: string;
  importProgress?: number;
  elapsed?: string;
}

interface BackupImportSummary {
  orgName: string;
  adminCount: number;
  recipientCount: number;
  driverCount: number;
  zoneCount: number;
  dispatchSessionCount: number;
  deliveryCount: number;
  checkInCount: number;
  includesMapData: boolean;
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  { num: 1, labelKey: "dashboard.setup.stepAccount" },
  { num: 2, labelKey: "dashboard.setup.stepRegion" },
  { num: 3, labelKey: "dashboard.setup.stepMaps" },
  { num: 4, labelKey: "dashboard.setup.stepNotifications" },
  { num: 5, labelKey: "dashboard.setup.stepSecurity" },
];

// ---------------------------------------------------------------------------
// Setup Wizard
// ---------------------------------------------------------------------------

export default function SetupPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [setupMode, setSetupMode] = useState<"create" | "restore">("create");

  // Step 1: Account
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [accountError, setAccountError] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [confirmBackupPassphrase, setConfirmBackupPassphrase] = useState("");
  const [importError, setImportError] = useState("");
  const [importingBackup, setImportingBackup] = useState(false);
  const [restoredSummary, setRestoredSummary] = useState<BackupImportSummary | null>(null);

  // Step 2: Operating region
  const [lat, setLat] = useState(39.8283);
  const [lng, setLng] = useState(-98.5795);
  const [zoom, setZoom] = useState(4);
  const [bounds, setBounds] = useState<{
    south: number; west: number; north: number; east: number;
  } | null>(null);
  const [label, setLabel] = useState("");
  const [savingRegion, setSavingRegion] = useState(false);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Step 3: Provision
  const [provisionStatus, setProvisionStatus] = useState<ProvisionStatus>({
    status: "not_started",
  });
  const [provisioning, setProvisioning] = useState(false);

  // Step 4: WhatsApp setup
  const [signalPhone, setSignalPhone] = useState("");
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioPhone, setTwilioPhone] = useState("");
  const [waSetupStep, setWaSetupStep] = useState<1 | 2 | 3>(1);
  const [waLines, setWaLines] = useState<Array<{
    id: string; label: string; status: string;
    phoneNumber: string | null; qrCode: string | null;
    isPrimary: boolean; isRelayPool: boolean; error: string | null;
  }>>([]);
  const [waConnecting, setWaConnecting] = useState(false);
  const [waError, setWaError] = useState("");
  const [showAdvancedNotif, setShowAdvancedNotif] = useState(false);
  const waQrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check setup progress on mount
  useEffect(() => {
    apiGet<any>("/api/setup/status").then((res) => {
      if (res.ok && res.data?.setupComplete) {
        router.push("/");
      } else if (res.ok && res.data?.steps) {
        const s = res.data.steps;
        if (s.adminCreated && !getToken()) {
          router.push("/login");
          return;
        }
        if (s.adminCreated && s.operatingRegionSet && (s.mapsStatus === "ready" || s.mapsStatus === "importing")) {
          setStep(4); // Skip to notifications if maps are downloading
        } else if (s.adminCreated && s.operatingRegionSet) {
          setStep(3);
          setProvisionStatus({
            status: s.mapsStatus || "not_started",
            message: s.mapsStatus === "importing" ? "Maps are being imported..." : undefined,
          });
        } else if (s.adminCreated) {
          setStep(2);
        }
      }
    });
  }, [router]);

  // Poll provision status when on steps 3-5
  useEffect(() => {
    if (step < 3) return;
    let active = true;

    async function poll() {
      const authRes = await apiGet<ProvisionStatus>("/api/settings/provision-status");
      if (authRes.ok && active) {
        setProvisionStatus(authRes.data);
      } else {
        const setupRes = await apiGet<any>("/api/setup/status");
        if (setupRes.ok && active) {
          const s = setupRes.data.steps;
          setProvisionStatus({
            status: s.mapsProvisioned ? "ready" : (s.mapsStatus || "not_started"),
            message: s.importMessage,
          });
        }
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [step]);

  // Step 1: Create account
  async function handleCreateAccount() {
    setAccountError("");
    if (password !== confirmPassword) { setAccountError(t('dashboard.setup.passwordsDoNotMatch')); return; }
    if (password.length < 8) { setAccountError(t('dashboard.setup.passwordTooShort')); return; }
    setCreatingAccount(true);

    const regRes = await apiPost<any>("/api/auth/admin/register", { email, password });
    if (!regRes.ok) { setAccountError(regRes.error || t('dashboard.common.failed')); setCreatingAccount(false); return; }

    const loginRes = await apiPost<{ token: string }>("/api/auth/admin/login", { email, password });
    if (loginRes.ok && loginRes.data?.token) {
      setToken(loginRes.data.token);
      setStep(2);
    } else {
      setAccountError(t('dashboard.setup.accountCreatedLoginFailed'));
    }
    setCreatingAccount(false);
  }

  async function handleImportBackup() {
    setImportError("");

    if (!backupFile) {
      setImportError("Choose a SafeCare backup file first.");
      return;
    }

    if (backupPassphrase.length < 12) {
      setImportError("Use the same backup passphrase you chose during export.");
      return;
    }

    if (backupPassphrase !== confirmBackupPassphrase) {
      setImportError("The backup passphrases do not match.");
      return;
    }

    setImportingBackup(true);

    try {
      const backup = await backupFile.text();
      const res = await apiPost<{
        restored: boolean;
        requiresMapProvisioning: boolean;
        summary: BackupImportSummary;
      }>("/api/setup/import-backup", {
        passphrase: backupPassphrase,
        backup,
      });

      if (res.ok && res.data?.restored) {
        setRestoredSummary(res.data.summary);
        setBackupFile(null);
        setBackupPassphrase("");
        setConfirmBackupPassphrase("");
        return;
      }

      setImportError(res.error || "Failed to restore the backup.");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to restore the backup.");
    } finally {
      setImportingBackup(false);
    }
  }

  // Search for city
  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 3) { setSearchResults([]); setShowResults(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await apiPost<GeocodingResult[]>("/api/geocode/search", { query: value, limit: 5 });
      if (res.ok && Array.isArray(res.data)) { setSearchResults(res.data); setShowResults(true); }
      setSearching(false);
    }, 500);
  }, []);

  function handleSelectResult(result: GeocodingResult) {
    setLat(result.lat); setLng(result.lng); setZoom(12);
    setLabel(result.displayName); setSearchQuery(result.displayName); setShowResults(false);
  }

  // Step 2: Save region
  async function handleSaveRegion() {
    setSavingRegion(true);
    await apiPut("/api/settings", {
      orgName: orgName || "My Organization",
      serviceArea: { lat, lng, zoom, label: label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, bounds },
    });
    setSavingRegion(false);
    setStep(3);
  }

  // Step 3: Provision maps
  async function handleProvision() {
    setProvisioning(true);
    setProvisionStatus({ status: "downloading", message: "Connecting to download server..." });
    const res = await apiPost("/api/settings/provision-maps", {});
    if (!res.ok) {
      setProvisionStatus({ status: "error", message: res.error || "Failed to start download." });
    }
    setProvisioning(false);
  }

  // Close search results on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) setShowResults(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Size estimate for viewport
  function getRegionEstimate() {
    if (!bounds) return null;
    const areaSqDeg = (bounds.north - bounds.south) * (bounds.east - bounds.west);
    const estMB = Math.round(areaSqDeg * 40);
    const estRAM = Math.round(areaSqDeg * 80);
    return { estMB, estRAM, isLarge: estRAM > 1500, isVeryLarge: estRAM > 3000 };
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-xl">
            SC
          </div>
          <h1 className="text-3xl font-bold">{t('dashboard.setup.title')}</h1>
          <p className="text-muted-foreground mt-2">
            {t('dashboard.setup.subtitle')}
          </p>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {STEPS.map((s) => (
            <div key={s.num} className="flex items-center gap-1">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium ${
                s.num < step ? "bg-emerald-600 text-white"
                  : s.num === step ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}>
                {s.num < step ? "\u2713" : s.num}
              </div>
              <span className={`text-xs hidden sm:inline ${
                s.num === step ? "font-medium" : "text-muted-foreground"
              }`}>{t(s.labelKey)}</span>
              {s.num < STEPS.length && <div className="w-4 h-px bg-border hidden sm:block" />}
            </div>
          ))}
        </div>

        {/* ================================================================ */}
        {/* Step 1: Create Account */}
        {/* ================================================================ */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>
                {restoredSummary ? "Backup restored" : "Choose how to start"}
              </CardTitle>
              {!restoredSummary && (
                <p className="text-sm text-muted-foreground">
                  Create a new SafeCare setup, or restore a previous encrypted backup before reinstalling.
                </p>
              )}
            </CardHeader>
            {!restoredSummary && (
              <CardContent className="space-y-4">
                <div className="inline-flex rounded-lg border bg-muted p-1">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      setupMode === "create"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                    onClick={() => {
                      setSetupMode("create");
                      setImportError("");
                    }}
                    data-testid="setup-mode-create"
                  >
                    Start new setup
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      setupMode === "restore"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                    onClick={() => {
                      setSetupMode("restore");
                      setAccountError("");
                    }}
                    data-testid="setup-mode-restore"
                  >
                    Restore backup
                  </button>
                </div>

                {setupMode === "create" && (
                  <div className="space-y-4">
                    {accountError && (
                      <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{accountError}</div>
                    )}
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('dashboard.setup.orgNameLabel')}</label>
                      <Input data-testid="setup-org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={t('dashboard.setup.orgNamePlaceholder')} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('dashboard.common.email')}</label>
                      <Input data-testid="setup-admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('dashboard.setup.password')}</label>
                      <Input data-testid="setup-admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('dashboard.setup.passwordPlaceholder')} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('dashboard.setup.confirmPassword')}</label>
                      <Input data-testid="setup-admin-confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t('dashboard.setup.confirmPasswordPlaceholder')} />
                    </div>
                  </div>
                )}

                {setupMode === "restore" && (
                  <div className="space-y-4">
                    <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground space-y-1">
                      <p>
                        Restore an encrypted `.scbackup` file from a previous SafeCare setup.
                      </p>
                      <p>
                        This restores the saved organization data and admin accounts, but map tiles and imported map data still need to be reprovisioned on the new machine.
                      </p>
                    </div>

                    {importError && (
                      <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive" data-testid="setup-import-error">
                        {importError}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-sm font-medium">Backup file</label>
                      <Input
                        data-testid="setup-backup-file"
                        type="file"
                        accept=".scbackup,application/octet-stream"
                        onChange={(e) => setBackupFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Backup passphrase</label>
                      <Input
                        data-testid="setup-backup-passphrase"
                        type="password"
                        value={backupPassphrase}
                        onChange={(e) => setBackupPassphrase(e.target.value)}
                        placeholder="Enter the backup passphrase"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Confirm passphrase</label>
                      <Input
                        data-testid="setup-backup-confirm-passphrase"
                        type="password"
                        value={confirmBackupPassphrase}
                        onChange={(e) => setConfirmBackupPassphrase(e.target.value)}
                        placeholder="Enter the same passphrase again"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            )}

            {restoredSummary ? (
              <>
                <CardContent className="space-y-4">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    The backup was restored successfully. Sign in with one of the restored admin accounts to continue setup and reprovision maps on this machine.
                  </div>
                  <div className="rounded-md border bg-muted/40 p-4 text-sm">
                    <p className="font-medium">{restoredSummary.orgName || "Restored organization"}</p>
                    <p className="text-muted-foreground mt-2">
                      {restoredSummary.adminCount} admin account{restoredSummary.adminCount === 1 ? "" : "s"}, {restoredSummary.recipientCount} recipient{restoredSummary.recipientCount === 1 ? "" : "s"}, {restoredSummary.driverCount} driver{restoredSummary.driverCount === 1 ? "" : "s"}, and {restoredSummary.deliveryCount} deliver{restoredSummary.deliveryCount === 1 ? "y" : "ies"} restored.
                    </p>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => router.push("/login?restored=1")}
                    data-testid="setup-import-continue-login"
                  >
                    Sign in to continue setup
                  </Button>
                </CardFooter>
              </>
            ) : (
              <CardFooter>
                {setupMode === "create" ? (
                  <Button data-testid="setup-create-account" onClick={handleCreateAccount} disabled={creatingAccount || !email || !password || !confirmPassword} className="w-full" size="lg">
                    {creatingAccount ? t('dashboard.setup.creatingAccount') : t('dashboard.setup.createAndContinue')}
                  </Button>
                ) : (
                  <Button
                    data-testid="setup-import-backup"
                    onClick={handleImportBackup}
                    disabled={importingBackup || !backupFile || !backupPassphrase || !confirmBackupPassphrase}
                    className="w-full"
                    size="lg"
                  >
                    {importingBackup ? "Restoring backup..." : "Restore encrypted backup"}
                  </Button>
                )}
              </CardFooter>
            )}
          </Card>
        )}

        {/* ================================================================ */}
        {/* Step 2: Operating Region */}
        {/* ================================================================ */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.setup.defineOperatingRegion')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('dashboard.setup.regionDesc')}
              </p>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                <li>{t('dashboard.setup.deliveryNeighborhoods')}</li>
                <li>{t('dashboard.setup.driverAreas')}</li>
                <li>{t('dashboard.setup.routesBetween')}</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                {t('dashboard.setup.defineZonesLater')}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative z-[10000]" ref={resultsRef}>
                <Input value={searchQuery} onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  data-testid="setup-region-search"
                  placeholder={t('dashboard.setup.searchCityPlaceholder')} />
                {searching && <div className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />}
                {showResults && searchResults.length > 0 && (
                  <div className="absolute z-[10001] mt-1 w-full rounded-md border bg-card text-card-foreground shadow-xl max-h-60 overflow-y-auto">
                    {searchResults.map((result, i) => (
                      <button key={i} onClick={() => handleSelectResult(result)}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors border-b last:border-0">
                        <p className="font-medium leading-snug">{result.displayName}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {tilesUnavailable && (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm space-y-1" data-testid="setup-region-tiles-warning">
                  <p className="font-medium text-amber-700 dark:text-amber-400">Map tiles aren&apos;t downloaded yet</p>
                  <p className="text-xs text-muted-foreground">
                    That&apos;s expected on a fresh install — they download in the next step. You can still pick your region now: search for your city above, confirm the bordered area covers your service area, then click <span className="font-medium">Save Region &amp; Continue</span>.
                  </p>
                </div>
              )}

              <SettingsMap lat={lat} lng={lng} zoom={zoom}
                onBoundsChange={(newBounds, newZoom, center) => {
                  setBounds(newBounds); setZoom(newZoom); setLat(center.lat); setLng(center.lng);
                }}
                onTileError={() => setTilesUnavailable(true)} />

              {/* Size estimate */}
              {bounds && (() => {
                const est = getRegionEstimate();
                if (!est) return null;
                return (
                  <div className="rounded-md border bg-muted/50 px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t('dashboard.settings.estimatedSize')}</span>
                      <span className={`font-medium ${est.isVeryLarge ? "text-destructive" : est.isLarge ? "text-amber-500" : "text-emerald-600"}`}>
                        ~{est.estMB < 1 ? '<1' : est.estMB} MB download, ~{est.estRAM < 100 ? '<100' : est.estRAM} MB RAM
                      </span>
                    </div>
                    {est.isVeryLarge && <p className="text-xs text-destructive">{t('dashboard.settings.largeRegionWarning')}</p>}
                    {est.isLarge && !est.isVeryLarge && <p className="text-xs text-amber-500">{t('dashboard.settings.mediumRegionNote')}</p>}
                  </div>
                );
              })()}
            </CardContent>
            <CardFooter>
              <Button data-testid="setup-save-region" onClick={handleSaveRegion} disabled={savingRegion || !bounds} className="w-full" size="lg">
                {savingRegion ? t('dashboard.common.saving') : t('dashboard.setup.saveRegionAndContinue')}
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ================================================================ */}
        {/* Step 3: Download Maps */}
        {/* ================================================================ */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>
                {provisionStatus.status === "ready" ? t('dashboard.setup.mapsReady') : t('dashboard.setup.downloadMapData')}
              </CardTitle>
              {provisionStatus.status !== "ready" && provisionStatus.status !== "downloading" && provisionStatus.status !== "importing" && (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.setup.mapDataDesc')}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {provisionStatus.status === "not_started" && (
                <Button data-testid="setup-provision-maps" onClick={handleProvision} disabled={provisioning} className="w-full" size="lg">
                  {provisioning ? t('dashboard.common.starting') : t('dashboard.setup.downloadMapData')}
                </Button>
              )}

              {provisionStatus.status === "downloading" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent flex-shrink-0" />
                    <span>{provisionStatus.message || t('dashboard.setup.downloading')}</span>
                  </div>
                  {(provisionStatus as any).progress != null && (
                    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${(provisionStatus as any).progress}%` }} />
                    </div>
                  )}
                </div>
              )}

              {provisionStatus.status === "importing" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent flex-shrink-0" />
                    <span className="font-medium">{provisionStatus.message || t('dashboard.setup.importing')}</span>
                  </div>
                  {provisionStatus.importProgress != null && (
                    <div className="space-y-1">
                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all duration-1000"
                          style={{ width: `${provisionStatus.importProgress}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">~{provisionStatus.importProgress}% {provisionStatus.elapsed && `\u2014 ${provisionStatus.elapsed}`}</p>
                    </div>
                  )}
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.setup.mapsImportingBackground')}
                    </p>
                  </div>
                  <Button data-testid="setup-continue-while-importing" onClick={() => setStep(4)} className="w-full" size="lg">
                    {t('dashboard.setup.continueWhileImporting')}
                  </Button>
                </div>
              )}

              {provisionStatus.status === "ready" && (
                <div className="text-center space-y-4">
                  <div className="mx-auto h-16 w-16 rounded-full bg-emerald-600/20 flex items-center justify-center">
                    <span className="text-3xl text-emerald-600">&#10003;</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{t('dashboard.setup.mapsReadyDesc')}</p>
                  <Button data-testid="setup-continue-from-maps" onClick={() => setStep(4)} className="w-full" size="lg">{t('dashboard.common.continue')}</Button>
                </div>
              )}

              {provisionStatus.status === "error" && (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">{provisionStatus.message || t('dashboard.common.error')}</p>
                  <Button data-testid="setup-retry-provision" onClick={handleProvision} disabled={provisioning} variant="outline">{t('dashboard.common.retry')}</Button>
                  <Button data-testid="setup-skip-maps" onClick={() => setStep(4)} variant="ghost" className="ml-2">{t('dashboard.setup.skipForNow')}</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ================================================================ */}
        {/* Step 4: WhatsApp & Notification Setup */}
        {/* ================================================================ */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.setup.whatsappSetup')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('dashboard.setup.whatsappSetupDesc')}
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Sub-step indicator */}
              <div className="flex items-center gap-3">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium ${
                      s < waSetupStep ? "bg-emerald-600 text-white"
                        : s === waSetupStep ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {s < waSetupStep ? "\u2713" : s}
                    </div>
                    <span className={`text-xs ${s === waSetupStep ? "font-medium" : "text-muted-foreground"}`}>
                      {s === 1 ? t('dashboard.setup.waStep1Label') : s === 2 ? t('dashboard.setup.waStep2Label') : t('dashboard.setup.waStep3Label')}
                    </span>
                    {s < 3 && <div className="w-4 h-px bg-border" />}
                  </div>
                ))}
              </div>

              {/* Sub-step 1: Get a SIM card */}
              {waSetupStep === 1 && (
                <div className="space-y-4">
                  <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-5 space-y-4">
                    <h3 className="text-base font-semibold">{t('dashboard.setup.waGetSimTitle')}</h3>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <div className="flex gap-3">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">1</span>
                        <p>{t('dashboard.setup.waGetSimStep1')}</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">2</span>
                        <p>{t('dashboard.setup.waGetSimStep2')}</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">3</span>
                        <p>{t('dashboard.setup.waGetSimStep3')}</p>
                      </div>
                    </div>
                    <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400">
                      {t('dashboard.setup.waSimTip')}
                    </div>
                  </div>
                  <Button onClick={() => setWaSetupStep(2)} className="w-full" size="lg">
                    {t('dashboard.setup.waSimReady')}
                  </Button>
                </div>
              )}

              {/* Sub-step 2: Install WhatsApp and register */}
              {waSetupStep === 2 && (
                <div className="space-y-4">
                  <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-5 space-y-4">
                    <h3 className="text-base font-semibold">{t('dashboard.setup.waInstallTitle')}</h3>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <div className="flex gap-3">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">1</span>
                        <p>{t('dashboard.setup.waInstallStep1')}</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">2</span>
                        <p>{t('dashboard.setup.waInstallStep2')}</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">3</span>
                        <p>{t('dashboard.setup.waInstallStep3')}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setWaSetupStep(1)}>{t('dashboard.common.back')}</Button>
                    <Button onClick={() => setWaSetupStep(3)} className="flex-1" size="lg">
                      {t('dashboard.setup.waInstallDone')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Sub-step 3: Link to SafeCare (scan QR) */}
              {waSetupStep === 3 && (
                <div className="space-y-4">
                  <div className="rounded-lg border p-5 space-y-4">
                    <h3 className="text-base font-semibold">{t('dashboard.setup.waLinkTitle')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.setup.waLinkDesc')}
                    </p>

                    {/* Check if we have a connected primary line */}
                    {(() => {
                      const primaryLine = waLines.find((l) => l.isPrimary);
                      const isConnected = primaryLine?.status === 'connected';
                      const hasQr = primaryLine?.status === 'qr_ready' && primaryLine?.qrCode;

                      if (isConnected) {
                        return (
                          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-center space-y-2">
                            <div className="text-3xl">&#10003;</div>
                            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                              {t('dashboard.setup.waConnected')}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {primaryLine?.phoneNumber}
                            </p>
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-4">
                          {/* Instructions */}
                          <div className="rounded-md bg-muted/50 p-3 space-y-2 text-sm">
                            <p className="font-medium">{t('dashboard.setup.waLinkInstructions')}</p>
                            <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                              <li>{t('dashboard.setup.waLinkStep1')}</li>
                              <li>{t('dashboard.setup.waLinkStep2')}</li>
                              <li>{t('dashboard.setup.waLinkStep3')}</li>
                            </ol>
                          </div>

                          {/* QR Code area */}
                          {hasQr ? (
                            <div className="flex flex-col items-center gap-3 p-4 rounded-md border bg-white dark:bg-black">
                              <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(primaryLine!.qrCode!)}`}
                                alt="WhatsApp QR Code"
                                className="w-64 h-64"
                              />
                              <p className="text-xs text-muted-foreground">
                                {t('dashboard.setup.waQrScanPrompt')}
                              </p>
                            </div>
                          ) : waConnecting ? (
                            <div className="flex flex-col items-center gap-3 p-8">
                              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                              <p className="text-sm text-muted-foreground">{t('dashboard.setup.waWaitingForQr')}</p>
                            </div>
                          ) : (
                            <Button
                              onClick={async () => {
                                setWaError("");
                                setWaConnecting(true);

                                // Create primary line if none exists
                                let targetLineId: string | null = null;
                                const existing = waLines.find((l) => l.isPrimary);

                                if (existing) {
                                  targetLineId = existing.id;
                                } else {
                                  const createRes = await apiPost<{ id: string }>("/api/whatsapp/lines", {
                                    label: "Main Line",
                                    isPrimary: true,
                                    isRelayPool: false,
                                  });
                                  if (createRes.ok && createRes.data?.id) {
                                    targetLineId = createRes.data.id;
                                    setWaLines((prev) => [...prev, {
                                      id: createRes.data!.id, label: "Main Line",
                                      status: "disconnected", phoneNumber: null,
                                      qrCode: null, isPrimary: true, isRelayPool: false, error: null,
                                    }]);
                                  } else {
                                    setWaError(createRes.error || "Failed to create WhatsApp line");
                                    setWaConnecting(false);
                                    return;
                                  }
                                }

                                // Start connection
                                const connectRes = await apiPost<{ status: string; qrCode?: string }>(`/api/whatsapp/lines/${targetLineId}/connect`);
                                if (connectRes.ok && connectRes.data) {
                                  setWaLines((prev) => prev.map((l) =>
                                    l.id === targetLineId
                                      ? { ...l, status: connectRes.data!.status, qrCode: connectRes.data!.qrCode ?? null }
                                      : l
                                  ));
                                }

                                // Start polling for QR/connection updates
                                if (waQrPollRef.current) clearInterval(waQrPollRef.current);
                                waQrPollRef.current = setInterval(async () => {
                                  const qrRes = await apiGet<{ status: string; qrCode: string | null }>(`/api/whatsapp/lines/${targetLineId}/qr`);
                                  if (qrRes.ok && qrRes.data) {
                                    setWaLines((prev) => prev.map((l) =>
                                      l.id === targetLineId
                                        ? { ...l, status: qrRes.data!.status, qrCode: qrRes.data!.qrCode }
                                        : l
                                    ));
                                    if (qrRes.data.status === 'connected') {
                                      // Fetch full line data for phone number
                                      const linesRes = await apiGet<Array<{ id: string; label: string; status: string; phoneNumber: string | null; qrCode: string | null; isPrimary: boolean; isRelayPool: boolean; error: string | null }>>("/api/whatsapp/lines");
                                      if (linesRes.ok && linesRes.data) {
                                        setWaLines(linesRes.data);
                                      }
                                      if (waQrPollRef.current) {
                                        clearInterval(waQrPollRef.current);
                                        waQrPollRef.current = null;
                                      }
                                      setWaConnecting(false);
                                    }
                                  }
                                }, 2000);

                                setWaConnecting(false);
                              }}
                              className="w-full"
                              size="lg"
                            >
                              {t('dashboard.setup.waStartPairing')}
                            </Button>
                          )}

                          {waError && (
                            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{waError}</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <Button variant="ghost" onClick={() => setWaSetupStep(2)} className="text-xs">{t('dashboard.common.back')}</Button>
                </div>
              )}

              {/* Advanced: Signal & Twilio (collapsible) */}
              <div className="border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdvancedNotif(!showAdvancedNotif)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <span className={`transition-transform ${showAdvancedNotif ? "rotate-90" : ""}`}>&#9654;</span>
                  {t('dashboard.setup.advancedChannels')}
                </button>

                {showAdvancedNotif && (
                  <div className="mt-4 space-y-4">
                    {/* Signal */}
                    <div className="rounded-md border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">{t('dashboard.setup.signalRecommended')}</h3>
                          <p className="text-xs text-muted-foreground">{t('dashboard.setup.signalDesc')}</p>
                        </div>
                        <span className="text-xs bg-emerald-600/20 text-emerald-600 px-2 py-1 rounded-md font-medium">{t('dashboard.common.free')}</span>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{t('dashboard.setup.signalPhoneLabel')}</label>
                        <Input value={signalPhone} onChange={(e) => setSignalPhone(e.target.value)} placeholder="+1234567890" className="text-sm" />
                      </div>
                    </div>

                    {/* Twilio SMS */}
                    <div className="rounded-md border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">{t('dashboard.setup.twilioSms')}</h3>
                          <p className="text-xs text-muted-foreground">{t('dashboard.setup.twilioDesc')}</p>
                        </div>
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-md">{t('dashboard.common.optional')}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('dashboard.setup.accountSid')}</label>
                          <Input value={twilioSid} onChange={(e) => setTwilioSid(e.target.value)} placeholder="AC..." className="text-sm" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('dashboard.setup.authToken')}</label>
                          <Input type="password" value={twilioToken} onChange={(e) => setTwilioToken(e.target.value)} placeholder="Token" className="text-sm" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{t('dashboard.setup.twilioPhoneLabel')}</label>
                        <Input value={twilioPhone} onChange={(e) => setTwilioPhone(e.target.value)} placeholder="+1234567890" className="text-sm" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Map import status (small, non-blocking) */}
              {provisionStatus.status === "importing" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md bg-muted/50 p-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent flex-shrink-0" />
                  {t('dashboard.setup.mapsStillImporting')} {provisionStatus.importProgress != null && `(~${provisionStatus.importProgress}%)`}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button data-testid="setup-skip-notifications" variant="ghost" onClick={() => {
                if (waQrPollRef.current) { clearInterval(waQrPollRef.current); waQrPollRef.current = null; }
                setStep(5);
              }}>{t('dashboard.setup.skipForNow')}</Button>
              <Button data-testid="setup-continue-notifications" onClick={() => {
                if (waQrPollRef.current) { clearInterval(waQrPollRef.current); waQrPollRef.current = null; }
                setStep(5);
              }} className="flex-1" size="lg">{t('dashboard.common.continue')}</Button>
            </CardFooter>
          </Card>
        )}

        {/* ================================================================ */}
        {/* Step 5: Security & Privacy Briefing */}
        {/* ================================================================ */}
        {step === 5 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.setup.protectingPrivacy')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('dashboard.setup.privacyDesc')}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128274;</span>
                  <div>
                    <p className="text-sm font-medium">{t('dashboard.setup.addressesEncrypted')}</p>
                    <p className="text-xs text-muted-foreground">{t('dashboard.setup.addressesEncryptedDesc')}</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128241;</span>
                  <div>
                    <p className="text-sm font-medium">{t('dashboard.setup.driverPhonesAutoPurge')}</p>
                    <p className="text-xs text-muted-foreground">{t('dashboard.setup.driverPhonesAutoPurgeDesc')}</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128506;</span>
                  <div>
                    <p className="text-sm font-medium">{t('dashboard.setup.mapsSelfHosted')}</p>
                    <p className="text-xs text-muted-foreground">{t('dashboard.setup.mapsSelfHostedDesc')}</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128336;</span>
                  <div>
                    <p className="text-sm font-medium">{t('dashboard.setup.recordsDeletedDaily')}</p>
                    <p className="text-xs text-muted-foreground">{t('dashboard.setup.recordsDeletedDailyDesc')}</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#9992;&#65039;</span>
                  <div>
                    <p className="text-sm font-medium">{t('dashboard.setup.airplaneModeForDrivers')}</p>
                    <p className="text-xs text-muted-foreground">{t('dashboard.setup.airplaneModeDesc')}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-500">{t('dashboard.setup.yourResponsibilities')}</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>{t('dashboard.setup.vetDrivers')}</li>
                  <li>{t('dashboard.setup.noScreenshot')}</li>
                  <li>{t('dashboard.setup.limitAccess')}</li>
                  <li>{t('dashboard.setup.reviewPurgeWarnings')}</li>
                  <li>{t('dashboard.setup.emergencyDestroy')}</li>
                </ul>
              </div>

              {/* Map status */}
              {provisionStatus.status === "importing" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md bg-muted/50 p-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent flex-shrink-0" />
                  {t('dashboard.setup.mapsStillImporting')} {provisionStatus.importProgress != null && `(~${provisionStatus.importProgress}%)`}
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button data-testid="setup-finish" onClick={() => router.push("/")} className="w-full" size="lg">
                {t('dashboard.setup.goToDashboard')}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
