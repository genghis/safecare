import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/StatusBar";
import DeliveryCard from "@/components/DeliveryCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import { checkIn, pollStatus, downloadRoute } from "@/lib/api";
import { storeEncrypted, readEncrypted, purgeAll } from "@/lib/db";
import { enqueueUpdate, flushQueue } from "@/lib/sync";
import { useAutoSync, usePurgeCheck } from "@/lib/hooks";
import { confirmPurge } from "@/lib/api";

export type Delivery = {
  id: string;
  sequence: number;
  address: string;
  notes: string;
  status: "pending" | "in_transit" | "delivered";
};

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

  // Background auto-sync and TTL purge check
  useAutoSync();
  usePurgeCheck();

  // Load cached route data on mount
  const loadCachedRoute = useCallback(async () => {
    try {
      const cached = (await readEncrypted("routes", "currentRoute")) as {
        deliveries: Delivery[];
        sessionId: string;
      } | null;
      if (cached?.deliveries?.length) {
        setDeliveries(cached.deliveries);
        setSessionId(cached.sessionId ?? null);
        setSessionStatus("routes_released");
      }
    } catch {
      // No cached data or decryption failed
    }
  }, []);

  useEffect(() => {
    loadCachedRoute();
  }, [loadCachedRoute]);

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
        setDeliveries(items);
        setSessionId(route.sessionId);
        setSessionStatus("routes_released");

        // Cache encrypted
        await storeEncrypted("routes", "currentRoute", {
          deliveries: items,
          sessionId: route.sessionId,
          expiresAt: route.expiresAt,
        });
      } else {
        setError("Routes have not been released yet. Try again shortly.");
      }
    } catch {
      setError("Could not fetch routes. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    if (sessionStatus === "routes_released") {
      // Re-read cached data to pick up status changes from DeliveryDetail
      await loadCachedRoute();
    } else if (sessionStatus === "checked_in") {
      await handlePollAndDownload();
    }
  };

  const handleEndShift = async () => {
    setShowEndShift(false);
    setLoading(true);
    try {
      await flushQueue();
      await purgeAll();
      if (sessionId) {
        try {
          await confirmPurge(sessionId);
        } catch {
          // Best effort
        }
      }
      setDeliveries([]);
      setSessionStatus("shift_ended");
      navigate("/", { replace: true });
    } catch {
      setError("Could not end shift. Try again when online.");
    } finally {
      setLoading(false);
    }
  };

  const pendingCount = deliveries.filter((d) => d.status !== "delivered").length;
  const completedCount = deliveries.filter((d) => d.status === "delivered").length;

  return (
    <div className="screen">
      <StatusBar sessionStatus={sessionStatus} />

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
