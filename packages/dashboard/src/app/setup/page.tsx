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
// Setup Wizard
// ---------------------------------------------------------------------------

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1=account, 2=region, 3=provision

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
    south: number;
    west: number;
    north: number;
    east: number;
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

  // Check if setup is already complete
  useEffect(() => {
    apiGet<any>("/api/setup/status").then((res) => {
      if (res.ok && res.data?.setupComplete) {
        router.push("/");
      } else if (res.ok && res.data?.steps) {
        const s = res.data.steps;
        if (s.adminCreated && s.operatingRegionSet) setStep(3);
        else if (s.adminCreated) setStep(2);
      }
    });
  }, [router]);

  // Poll provision status in step 3
  useEffect(() => {
    if (step !== 3) return;
    let active = true;

    async function poll() {
      const res = await apiGet<ProvisionStatus>(
        "/api/settings/provision-status"
      );
      if (res.ok && active) {
        setProvisionStatus(res.data);
        if (res.data.status === "ready") {
          // Setup complete!
        }
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [step]);

  // Step 1: Create account
  async function handleCreateAccount() {
    setAccountError("");
    if (password !== confirmPassword) {
      setAccountError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setAccountError("Password must be at least 8 characters.");
      return;
    }

    setCreatingAccount(true);

    // Register
    const regRes = await apiPost<any>("/api/auth/admin/register", {
      email,
      password,
    });

    if (!regRes.ok) {
      setAccountError(regRes.error || "Failed to create account.");
      setCreatingAccount(false);
      return;
    }

    // Login
    const loginRes = await apiPost<{ token: string }>(
      "/api/auth/admin/login",
      { email, password }
    );

    if (loginRes.ok && loginRes.data?.token) {
      setToken(loginRes.data.token);
      setStep(2);
    } else {
      setAccountError("Account created but login failed. Try logging in.");
    }

    setCreatingAccount(false);
  }

  // Search
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

  function handleSelectResult(result: GeocodingResult) {
    setLat(result.lat);
    setLng(result.lng);
    setZoom(12);
    setLabel(result.displayName);
    setSearchQuery(result.displayName);
    setShowResults(false);
  }

  // Step 2: Save region
  async function handleSaveRegion() {
    setSavingRegion(true);
    await apiPut("/api/settings", {
      orgName: orgName || "My Organization",
      serviceArea: {
        lat,
        lng,
        zoom,
        label: label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        bounds,
      },
    });
    setSavingRegion(false);
    setStep(3);
  }

  // Step 3: Provision -- show immediate feedback
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
        message: res.error || "Failed to start download.",
      });
    }
    setProvisioning(false);
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
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  s < step
                    ? "bg-emerald-600 text-white"
                    : s === step
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s < step ? "\u2713" : s}
              </div>
              <span
                className={`text-sm hidden sm:inline ${
                  s === step ? "font-medium" : "text-muted-foreground"
                }`}
              >
                {s === 1
                  ? "Create Account"
                  : s === 2
                  ? "Set Region"
                  : "Provision Maps"}
              </span>
              {s < 3 && (
                <div className="w-8 h-px bg-border hidden sm:block" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Create Account */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Create Your Admin Account</CardTitle>
              <p className="text-sm text-muted-foreground">
                This will be the administrator account for managing deliveries,
                drivers, and recipients.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {accountError && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {accountError}
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Organization Name
                </label>
                <Input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g., Minneapolis Mutual Aid"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Confirm Password
                </label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Type password again"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button
                onClick={handleCreateAccount}
                disabled={
                  creatingAccount || !email || !password || !confirmPassword
                }
                className="w-full"
                size="lg"
              >
                {creatingAccount ? "Creating Account..." : "Create Account & Continue"}
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 2: Set Operating Region */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Define Your Operating Region</CardTitle>
              <p className="text-sm text-muted-foreground">
                Search for your city, then pan and zoom the map so the visible
                area covers everywhere your deliveries go and your drivers
                live. This determines which map data gets downloaded.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search */}
              <div className="relative z-[10000]" ref={resultsRef}>
                <Input
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() =>
                    searchResults.length > 0 && setShowResults(true)
                  }
                  placeholder="Search for your city..."
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
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Map */}
              <SettingsMap
                lat={lat}
                lng={lng}
                zoom={zoom}
                onBoundsChange={(newBounds, newZoom, center) => {
                  setBounds(newBounds);
                  setZoom(newZoom);
                  setLat(center.lat);
                  setLng(center.lng);
                }}
              />
            </CardContent>
            <CardFooter>
              <Button
                onClick={handleSaveRegion}
                disabled={savingRegion || !bounds}
                className="w-full"
                size="lg"
              >
                {savingRegion ? "Saving..." : "Save Region & Continue"}
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 3: Provision Maps */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>
                {provisionStatus.status === "ready"
                  ? "Setup Complete!"
                  : "Download Map Data"}
              </CardTitle>
              {provisionStatus.status !== "ready" && (
                <p className="text-sm text-muted-foreground">
                  SafeCare needs to download OpenStreetMap data for your region.
                  This enables address search, driving directions, and offline
                  maps for drivers. The download happens once.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {provisionStatus.status === "not_started" && (
                <Button
                  onClick={handleProvision}
                  disabled={provisioning}
                  className="w-full"
                  size="lg"
                >
                  {provisioning
                    ? "Starting Download..."
                    : "Download Map Data"}
                </Button>
              )}

              {provisionStatus.status === "downloading" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent flex-shrink-0" />
                    <span>
                      {provisionStatus.message || "Downloading..."}
                    </span>
                  </div>
                  {(provisionStatus as any).progress != null && (
                    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{
                          width: `${(provisionStatus as any).progress}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {provisionStatus.status === "importing" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent flex-shrink-0" />
                    <span className="font-medium">
                      {provisionStatus.message || "Importing map data..."}
                    </span>
                  </div>
                  {provisionStatus.importProgress != null && (
                    <div className="space-y-1">
                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-1000"
                          style={{
                            width: `${provisionStatus.importProgress}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        ~{provisionStatus.importProgress}% complete
                        {provisionStatus.elapsed &&
                          ` \u2014 ${provisionStatus.elapsed} elapsed`}
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    This can take 15-60 minutes (longer on Raspberry Pi). You
                    can close this page and come back later.
                  </p>
                </div>
              )}

              {provisionStatus.status === "ready" && (
                <div className="text-center space-y-4">
                  <div className="mx-auto h-16 w-16 rounded-full bg-emerald-600/20 flex items-center justify-center">
                    <span className="text-3xl text-emerald-600">
                      &#10003;
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Map data is ready. Address search, routing, and offline maps
                    are all working. You can now start adding recipients and
                    drivers.
                  </p>
                  <Button
                    onClick={() => router.push("/")}
                    className="w-full"
                    size="lg"
                  >
                    Go to Dashboard
                  </Button>
                </div>
              )}

              {provisionStatus.status === "error" && (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">
                    {provisionStatus.message || "Something went wrong."}
                  </p>
                  <Button
                    onClick={handleProvision}
                    disabled={provisioning}
                    variant="outline"
                  >
                    Retry
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
