import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/StatusBar";
import DeliveryCard from "@/components/DeliveryCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import RouteMap from "@/components/RouteMap";
import AirplaneModeReminder from "@/components/AirplaneModeReminder";
import { checkIn, pollStatus, downloadRoute } from "@/lib/api";
import { storeEncrypted, readEncrypted, purgeAll } from "@/lib/db";
import { flushQueue } from "@/lib/sync";
import { useAutoSync, usePurgeCheck } from "@/lib/hooks";
import { confirmPurge } from "@/lib/api";
import { cacheTiles, clearTileCache } from "@/lib/tile-cache";

export type Delivery = {
  id: string;
  sequence: number;
  address: string;
  notes: string;
  status: "pending" | "in_transit" | "delivered";
};

type StopWithGeo = {
  deliveryId: string;
  address: string;
  lat: number;
  lng: number;
  recipientName: string;
  sequence: number;
  status?: string;
};

type RouteGeo = { type: "LineString"; coordinates: [number, number][] };
type TileBounds = { south: number; west: number; north: number; east: number };

type SessionStatus = "idle" | "checked_in" | "routes_released" | "shift_ended";

export default function Dashboard() {
  const navigate = useNavigate();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showEndShift, setShowEndShift] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Map-related state
  const [stops, setStops] = useState<StopWithGeo[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<RouteGeo | undefined>();
  const [tileBounds, setTileBounds] = useState<TileBounds | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [tileCacheProgress, setTileCacheProgress] = useState<{
    cached: number;
    total: number;
  } | null>(null);
  const [tilesCached, setTilesCached] = useState(false);
  const [showMapCachedNotice, setShowMapCachedNotice] = useState(false);

  const geoWatchRef = useRef<number | null>(null);

  // Background auto-sync and TTL purge check
  useAutoSync();
  usePurgeCheck();

  // ---------------------------------------------------------------------------
  // Geolocation tracking for the map
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (sessionStatus !== "routes_released") return;
    if (!("geolocation" in navigator)) return;

    geoWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setCurrentLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        // Non-fatal; driver may not have granted permission
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => {
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
        geoWatchRef.current = null;
      }
    };
  }, [sessionStatus]);

  // ---------------------------------------------------------------------------
  // Load cached route data on mount
  // ---------------------------------------------------------------------------
  const loadCachedRoute = useCallback(async () => {
    try {
      const cached = (await readEncrypted("routes", "currentRoute")) as {
        deliveries: Delivery[];
        sessionId: string;
        stops?: StopWithGeo[];
        routeGeometry?: RouteGeo;
        tileBounds?: TileBounds;
        tilesCached?: boolean;
      } | null;
      if (cached?.deliveries?.length) {
        setDeliveries(cached.deliveries);
        setSessionId(cached.sessionId ?? null);
        setSessionStatus("routes_released");

        if (cached.stops) {
          // Merge current delivery statuses into stop data
          const statusMap = new Map(
            cached.deliveries.map((d) => [d.id, d.status]),
          );
          setStops(
            cached.stops.map((s) => ({
              ...s,
              status: statusMap.get(s.deliveryId) ?? s.status,
            })),
          );
        }
        if (cached.routeGeometry) setRouteGeometry(cached.routeGeometry);
        if (cached.tileBounds) setTileBounds(cached.tileBounds);
        if (cached.tilesCached) setTilesCached(true);
      }
    } catch {
      // No cached data or decryption failed
    }
  }, []);

  useEffect(() => {
    loadCachedRoute();
  }, [loadCachedRoute]);

  // ---------------------------------------------------------------------------
  // Check-in
  // ---------------------------------------------------------------------------
  const handleCheckIn = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await checkIn();
      setSessionId(result.sessionId);
      setSessionStatus("checked_in");
    } catch {
      setError("Could not check in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Poll + download route
  // ---------------------------------------------------------------------------
  const handlePollAndDownload = async () => {
    setError("");
    setRefreshing(true);
    try {
      const status = await pollStatus();
      if (status.routesReady && status.downloadToken) {
        const route = await downloadRoute(status.downloadToken);
        const items: Delivery[] = route.stops.map((s, i) => ({
          id: s.deliveryId,
          sequence: s.sequence ?? i + 1,
          address: s.address,
          notes: s.notes ?? "",
          status: "pending" as const,
        }));

        // Build stop geo data for the map
        const geoStops: StopWithGeo[] = route.stops.map((s, i) => ({
          deliveryId: s.deliveryId,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          recipientName: s.recipientName,
          sequence: s.sequence ?? i + 1,
          status: "pending",
        }));

        setDeliveries(items);
        setSessionId(route.sessionId);
        setSessionStatus("routes_released");
        setStops(geoStops);

        if (route.routeGeometry) setRouteGeometry(route.routeGeometry);
        if (route.tileBounds) setTileBounds(route.tileBounds);

        // Cache encrypted (including geo data for offline restore)
        await storeEncrypted("routes", "currentRoute", {
          deliveries: items,
          sessionId: route.sessionId,
          expiresAt: route.expiresAt,
          stops: geoStops,
          routeGeometry: route.routeGeometry,
          tileBounds: route.tileBounds,
          tilesCached: false,
        });

        // Pre-cache tiles for offline map use
        if (route.tileUrls?.length) {
          setTileCacheProgress({ cached: 0, total: route.tileUrls.length });
          try {
            await cacheTiles(route.tileUrls, (cached, total) => {
              setTileCacheProgress({ cached, total });
            });
            setTilesCached(true);
            setShowMapCachedNotice(true);

            // Update cached data to record tile caching complete
            await storeEncrypted("routes", "currentRoute", {
              deliveries: items,
              sessionId: route.sessionId,
              expiresAt: route.expiresAt,
              stops: geoStops,
              routeGeometry: route.routeGeometry,
              tileBounds: route.tileBounds,
              tilesCached: true,
            });

            // Auto-hide the notice after 4 seconds
            setTimeout(() => setShowMapCachedNotice(false), 4000);
          } catch {
            // Tile caching is best-effort; don't block the flow
          } finally {
            setTileCacheProgress(null);
          }
        }
      } else {
        setError("Routes have not been released yet. Try again shortly.");
      }
    } catch {
      setError("Could not fetch routes. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------
  const handleRefresh = async () => {
    if (sessionStatus === "routes_released") {
      // Re-read cached data to pick up status changes from DeliveryDetail
      await loadCachedRoute();
    } else if (sessionStatus === "checked_in") {
      await handlePollAndDownload();
    }
  };

  // ---------------------------------------------------------------------------
  // End shift
  // ---------------------------------------------------------------------------
  const handleEndShift = async () => {
    setShowEndShift(false);
    setLoading(true);
    try {
      await flushQueue();
      await purgeAll();
      await clearTileCache();
      if (sessionId) {
        try {
          await confirmPurge(sessionId);
        } catch {
          // Best effort
        }
      }
      setDeliveries([]);
      setStops([]);
      setRouteGeometry(undefined);
      setTileBounds(null);
      setTilesCached(false);
      setCurrentLocation(null);
      setSessionStatus("shift_ended");
      navigate("/", { replace: true });
    } catch {
      setError("Could not end shift. Try again when online.");
    } finally {
      setLoading(false);
    }
  };

  const pendingCount = deliveries.filter((d) => d.status !== "delivered").length;
  const completedCount = deliveries.filter(
    (d) => d.status === "delivered",
  ).length;

  return (
    <div className="screen">
      <StatusBar sessionStatus={sessionStatus} />

      {/* Airplane mode reminder */}
      {sessionStatus === "routes_released" && (
        <AirplaneModeReminder deliveryZoneBounds={tileBounds} />
      )}

      {/* Top nav bar */}
      <div
        className="flex-between"
        style={{ padding: "4px 16px 4px 16px", flexShrink: 0 }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "var(--color-primary)",
          }}
        >
          SafeCare
        </span>
        <button
          style={{
            padding: "10px 14px",
            minHeight: 44,
            color: "var(--color-primary)",
            fontSize: 15,
            fontWeight: 700,
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
          onClick={() => navigate("/profile")}
        >
          My Profile
        </button>
      </div>

      {/* Tile caching progress bar */}
      {tileCacheProgress && (
        <div
          style={{
            padding: "10px 16px",
            backgroundColor: "var(--color-card)",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text-secondary)",
              }}
            >
              Caching maps for offline use...
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-text-muted)",
                fontWeight: 600,
              }}
            >
              {tileCacheProgress.cached}/{tileCacheProgress.total}
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: "var(--color-border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 3,
                backgroundColor: "var(--color-primary)",
                width: `${(tileCacheProgress.cached / tileCacheProgress.total) * 100}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Map cached success notice */}
      {showMapCachedNotice && (
        <div
          style={{
            padding: "10px 16px",
            backgroundColor: "var(--color-primary-light)",
            color: "var(--color-primary)",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
            flexShrink: 0,
            animation: "slide-up 0.2s ease",
          }}
        >
          Maps cached! You can navigate offline.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          style={{
            backgroundColor: "var(--color-danger-light)",
            color: "var(--color-danger)",
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* Idle state */}
      {sessionStatus === "idle" && (
        <div className="flex-center flex-1" style={{ padding: "0 32px" }}>
          <div style={{ textAlign: "center" }}>
            <p
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--color-text)",
                marginBottom: 32,
              }}
            >
              Ready to start your shift?
            </p>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleCheckIn}
              disabled={loading}
              style={{ margin: "0 auto" }}
            >
              {loading ? <span className="spinner" /> : "Ready for Routes"}
            </button>
          </div>
        </div>
      )}

      {/* Checked in state */}
      {sessionStatus === "checked_in" && (
        <div className="flex-center flex-1" style={{ padding: "0 32px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#9203;</div>
            <p
              style={{
                fontSize: 18,
                color: "var(--color-text-secondary)",
                marginBottom: 24,
              }}
            >
              Waiting for routes to be released...
            </p>
            <button
              className="btn btn-secondary"
              onClick={handlePollAndDownload}
              disabled={refreshing}
              style={{ margin: "0 auto", minWidth: 200 }}
            >
              {refreshing ? (
                <span className="spinner spinner-dark" />
              ) : (
                "Check for Routes"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Routes released state */}
      {sessionStatus === "routes_released" && (
        <>
          {/* Summary counters */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-around",
              padding: "16px 12px",
              backgroundColor: "var(--color-card)",
              borderBottom: "1px solid var(--color-border)",
              flexShrink: 0,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: "var(--color-text)",
                }}
              >
                {pendingCount}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  marginTop: 2,
                }}
              >
                Remaining
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: "var(--color-primary)",
                }}
              >
                {completedCount}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  marginTop: 2,
                }}
              >
                Delivered
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: "var(--color-text)",
                }}
              >
                {deliveries.length}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  marginTop: 2,
                }}
              >
                Total
              </div>
            </div>
          </div>

          {/* Refresh button */}
          <div
            style={{
              padding: "8px 16px",
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            <button
              style={{
                background: "none",
                border: "none",
                color: "var(--color-primary)",
                fontSize: 14,
                fontWeight: 600,
                padding: "6px 10px",
                cursor: "pointer",
              }}
              onClick={handleRefresh}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {/* Route map */}
          {stops.length > 0 && (
            <div style={{ padding: "0 12px 12px 12px", flexShrink: 0 }}>
              <RouteMap
                stops={stops.map((s) => ({
                  ...s,
                  status:
                    deliveries.find((d) => d.id === s.deliveryId)?.status ??
                    s.status,
                }))}
                routeGeometry={routeGeometry}
                currentLocation={currentLocation}
                onStopClick={(deliveryId) =>
                  navigate(`/delivery/${deliveryId}`)
                }
              />
              {tilesCached && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    marginTop: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-primary)",
                      fontWeight: 600,
                    }}
                  >
                    Available offline
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Delivery list */}
          <div
            className="screen-scroll"
            style={{
              padding: "0 12px 120px 12px",
            }}
          >
            {deliveries.map((d) => (
              <DeliveryCard
                key={d.id}
                delivery={d}
                onPress={() => navigate(`/delivery/${d.id}`)}
              />
            ))}
          </div>

          {/* End Shift button */}
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              padding: "16px 24px",
              paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
              background:
                "linear-gradient(transparent, var(--color-bg) 20%)",
              pointerEvents: "none",
            }}
          >
            <button
              className="btn btn-danger btn-block"
              style={{
                minHeight: 56,
                fontSize: 18,
                pointerEvents: "auto",
              }}
              onClick={() => setShowEndShift(true)}
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : "End Shift"}
            </button>
          </div>
        </>
      )}

      {/* End Shift confirmation dialog */}
      <ConfirmDialog
        open={showEndShift}
        title="End Shift"
        message="This will sync remaining updates and clear all local data. This action cannot be undone."
        confirmText="End Shift"
        cancelText="Cancel"
        destructive
        onConfirm={handleEndShift}
        onCancel={() => setShowEndShift(false)}
      />
    </div>
  );
}
