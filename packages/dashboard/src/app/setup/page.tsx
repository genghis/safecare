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
import { apiPost, apiPut, apiGet, setToken } from "@/lib/api";

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

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  { num: 1, label: "Account" },
  { num: 2, label: "Region" },
  { num: 3, label: "Maps" },
  { num: 4, label: "Notifications" },
  { num: 5, label: "Security" },
];

// ---------------------------------------------------------------------------
// Setup Wizard
// ---------------------------------------------------------------------------

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1: Account
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [accountError, setAccountError] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);

  // Step 2: Operating region
  const [lat, setLat] = useState(39.8283);
  const [lng, setLng] = useState(-98.5795);
  const [zoom, setZoom] = useState(4);
  const [bounds, setBounds] = useState<{
    south: number; west: number; north: number; east: number;
  } | null>(null);
  const [label, setLabel] = useState("");
  const [savingRegion, setSavingRegion] = useState(false);

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

  // Step 4: Notifications
  const [signalPhone, setSignalPhone] = useState("");
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioPhone, setTwilioPhone] = useState("");

  // Check setup progress on mount
  useEffect(() => {
    apiGet<any>("/api/setup/status").then((res) => {
      if (res.ok && res.data?.setupComplete) {
        router.push("/");
      } else if (res.ok && res.data?.steps) {
        const s = res.data.steps;
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
    if (password !== confirmPassword) { setAccountError("Passwords do not match."); return; }
    if (password.length < 8) { setAccountError("Password must be at least 8 characters."); return; }
    setCreatingAccount(true);

    const regRes = await apiPost<any>("/api/auth/admin/register", { email, password });
    if (!regRes.ok) { setAccountError(regRes.error || "Failed to create account."); setCreatingAccount(false); return; }

    const loginRes = await apiPost<{ token: string }>("/api/auth/admin/login", { email, password });
    if (loginRes.ok && loginRes.data?.token) {
      setToken(loginRes.data.token);
      setStep(2);
    } else {
      setAccountError("Account created but login failed. Try the login page.");
    }
    setCreatingAccount(false);
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
          <h1 className="text-3xl font-bold">SafeCare Setup</h1>
          <p className="text-muted-foreground mt-2">
            Let&apos;s get your mutual aid delivery system running.
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
              }`}>{s.label}</span>
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
              <CardTitle>Create Your Admin Account</CardTitle>
              <p className="text-sm text-muted-foreground">
                This will be the administrator account for managing deliveries, drivers, and recipients.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {accountError && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{accountError}</div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">Organization Name</label>
                <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g., Minneapolis Mutual Aid" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Confirm Password</label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Type password again" />
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleCreateAccount} disabled={creatingAccount || !email || !password || !confirmPassword} className="w-full" size="lg">
                {creatingAccount ? "Creating Account..." : "Create Account & Continue"}
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ================================================================ */}
        {/* Step 2: Operating Region */}
        {/* ================================================================ */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Define Your Operating Region</CardTitle>
              <p className="text-sm text-muted-foreground">
                Search for your city, then pan and zoom the map so the visible area covers:
              </p>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                <li><strong>Delivery neighborhoods</strong> where recipients live</li>
                <li><strong>Driver areas</strong> where your volunteers come from</li>
                <li><strong>Routes between them</strong> -- drivers may need directions from home to the delivery area</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                You&apos;ll define specific delivery zones later. This is the broader region for maps and routing.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative z-[10000]" ref={resultsRef}>
                <Input value={searchQuery} onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  placeholder="Search for your city..." />
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

              <SettingsMap lat={lat} lng={lng} zoom={zoom}
                onBoundsChange={(newBounds, newZoom, center) => {
                  setBounds(newBounds); setZoom(newZoom); setLat(center.lat); setLng(center.lng);
                }} />

              {/* Size estimate */}
              {bounds && (() => {
                const est = getRegionEstimate();
                if (!est) return null;
                return (
                  <div className="rounded-md border bg-muted/50 px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Estimated size:</span>
                      <span className={`font-medium ${est.isVeryLarge ? "text-destructive" : est.isLarge ? "text-amber-500" : "text-emerald-600"}`}>
                        ~{est.estMB < 1 ? '<1' : est.estMB} MB download, ~{est.estRAM < 100 ? '<100' : est.estRAM} MB RAM
                      </span>
                    </div>
                    {est.isVeryLarge && <p className="text-xs text-destructive">This region may require 4+ GB RAM. Zoom in for smaller hardware.</p>}
                    {est.isLarge && !est.isVeryLarge && <p className="text-xs text-amber-500">Fine for 8GB, tight for 4GB hardware.</p>}
                  </div>
                );
              })()}
            </CardContent>
            <CardFooter>
              <Button onClick={handleSaveRegion} disabled={savingRegion || !bounds} className="w-full" size="lg">
                {savingRegion ? "Saving..." : "Save Region & Continue"}
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
                {provisionStatus.status === "ready" ? "Maps Ready!" : "Download Map Data"}
              </CardTitle>
              {provisionStatus.status !== "ready" && provisionStatus.status !== "downloading" && provisionStatus.status !== "importing" && (
                <p className="text-sm text-muted-foreground">
                  SafeCare needs map data for your region. This enables address search, driving directions, and offline maps for drivers. It&apos;s a one-time download.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {provisionStatus.status === "not_started" && (
                <Button onClick={handleProvision} disabled={provisioning} className="w-full" size="lg">
                  {provisioning ? "Starting..." : "Download Map Data"}
                </Button>
              )}

              {provisionStatus.status === "downloading" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent flex-shrink-0" />
                    <span>{provisionStatus.message || "Downloading..."}</span>
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
                    <span className="font-medium">{provisionStatus.message || "Importing..."}</span>
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
                      Maps are importing in the background. You can continue setting up while this runs.
                    </p>
                  </div>
                  <Button onClick={() => setStep(4)} className="w-full" size="lg">
                    Continue Setup While Maps Import
                  </Button>
                </div>
              )}

              {provisionStatus.status === "ready" && (
                <div className="text-center space-y-4">
                  <div className="mx-auto h-16 w-16 rounded-full bg-emerald-600/20 flex items-center justify-center">
                    <span className="text-3xl text-emerald-600">&#10003;</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Address search, routing, and offline maps are ready.</p>
                  <Button onClick={() => setStep(4)} className="w-full" size="lg">Continue</Button>
                </div>
              )}

              {provisionStatus.status === "error" && (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">{provisionStatus.message || "Something went wrong."}</p>
                  <Button onClick={handleProvision} disabled={provisioning} variant="outline">Retry</Button>
                  <Button onClick={() => setStep(4)} variant="ghost" className="ml-2">Skip for Now</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ================================================================ */}
        {/* Step 4: Notification Setup */}
        {/* ================================================================ */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>Set Up Notifications</CardTitle>
              <p className="text-sm text-muted-foreground">
                Recipients are notified when deliveries are on the way and when they arrive.
                Configure at least one channel. You can always add more later in Settings.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Signal */}
              <div className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Signal (Recommended)</h3>
                    <p className="text-xs text-muted-foreground">Free, end-to-end encrypted. Messages never leave your control.</p>
                  </div>
                  <span className="text-xs bg-emerald-600/20 text-emerald-600 px-2 py-1 rounded-md font-medium">Free</span>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Signal Phone Number (register at http://localhost:8089)</label>
                  <Input value={signalPhone} onChange={(e) => setSignalPhone(e.target.value)} placeholder="+1234567890" className="text-sm" />
                </div>
              </div>

              {/* Twilio SMS */}
              <div className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">SMS via Twilio</h3>
                    <p className="text-xs text-muted-foreground">Works on any phone. ~$0.01 per message.</p>
                  </div>
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-md">Optional</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Account SID</label>
                    <Input value={twilioSid} onChange={(e) => setTwilioSid(e.target.value)} placeholder="AC..." className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Auth Token</label>
                    <Input type="password" value={twilioToken} onChange={(e) => setTwilioToken(e.target.value)} placeholder="Token" className="text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Twilio Phone Number</label>
                  <Input value={twilioPhone} onChange={(e) => setTwilioPhone(e.target.value)} placeholder="+1234567890" className="text-sm" />
                </div>
              </div>

              {/* Map import status (small, non-blocking) */}
              {provisionStatus.status === "importing" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md bg-muted/50 p-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent flex-shrink-0" />
                  Maps still importing... {provisionStatus.importProgress != null && `(~${provisionStatus.importProgress}%)`}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(5)}>Skip for Now</Button>
              <Button onClick={() => setStep(5)} className="flex-1" size="lg">Continue</Button>
            </CardFooter>
          </Card>
        )}

        {/* ================================================================ */}
        {/* Step 5: Security & Privacy Briefing */}
        {/* ================================================================ */}
        {step === 5 && (
          <Card>
            <CardHeader>
              <CardTitle>Protecting Recipient Privacy</CardTitle>
              <p className="text-sm text-muted-foreground">
                SafeCare is built to protect the people you serve. Here&apos;s how it works and what you need to know.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128274;</span>
                  <div>
                    <p className="text-sm font-medium">Addresses are encrypted</p>
                    <p className="text-xs text-muted-foreground">Recipient names, addresses, and phone numbers are encrypted in the database. Even if someone accesses the server, they can&apos;t read the data without the encryption key.</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128241;</span>
                  <div>
                    <p className="text-sm font-medium">Driver phones auto-purge</p>
                    <p className="text-xs text-muted-foreground">Route data on driver phones is automatically deleted after each shift. If a driver doesn&apos;t end their shift, data self-destructs after 8 hours. You&apos;ll be alerted if a driver hasn&apos;t confirmed deletion.</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128506;</span>
                  <div>
                    <p className="text-sm font-medium">Maps and geocoding are self-hosted</p>
                    <p className="text-xs text-muted-foreground">Address searches run on this device, not Google or any external service. No recipient addresses ever leave your network.</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#128336;</span>
                  <div>
                    <p className="text-sm font-medium">Delivery records are deleted daily</p>
                    <p className="text-xs text-muted-foreground">Delivery records (which addresses got deliveries) are hard-deleted within 24 hours. Only anonymous audit counts are kept.</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md bg-muted/50 p-3">
                  <span className="text-lg flex-shrink-0">&#9992;&#65039;</span>
                  <div>
                    <p className="text-sm font-medium">Airplane mode for drivers</p>
                    <p className="text-xs text-muted-foreground">Drivers are prompted to enable airplane mode near delivery areas. This prevents their phone from broadcasting location data to cell towers while they&apos;re near recipients&apos; homes.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-500">Your responsibilities</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Vet drivers before approving them to receive routes</li>
                  <li>Don&apos;t screenshot or export recipient lists</li>
                  <li>Limit who has admin access to this dashboard</li>
                  <li>Review the purge warnings regularly (Settings page)</li>
                  <li>If a device is lost or compromised, use the emergency destroy script</li>
                </ul>
              </div>

              {/* Map status */}
              {provisionStatus.status === "importing" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md bg-muted/50 p-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent flex-shrink-0" />
                  Maps still importing... {provisionStatus.importProgress != null && `(~${provisionStatus.importProgress}%)`}
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button onClick={() => router.push("/")} className="w-full" size="lg">
                Go to Dashboard
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
