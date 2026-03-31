import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import StatusBar from "@/components/StatusBar";
import { readEncrypted, storeEncrypted } from "@/lib/db";
import { enqueueUpdate } from "@/lib/sync";
import { useLocale } from "@/lib/locale";
import type { Delivery } from "./Dashboard";

export default function DeliveryDetail() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [allDeliveries, setAllDeliveries] = useState<Delivery[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const cached = (await readEncrypted("routes", "currentRoute")) as {
          deliveries: Delivery[];
          sessionId: string;
        } | null;

        if (cached?.deliveries) {
          setAllDeliveries(cached.deliveries);
          setSessionId(cached.sessionId ?? null);
          const found = cached.deliveries.find((d) => d.id === id);
          setDelivery(found ?? null);
        }
      } catch {
        // Could not load
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const updateStatus = async (newStatus: Delivery["status"]) => {
    if (!delivery) return;

    const updated = { ...delivery, status: newStatus };
    setDelivery(updated);

    const updatedAll = allDeliveries.map((d) =>
      d.id === delivery.id ? updated : d
    );
    setAllDeliveries(updatedAll);

    // Persist updated list
    try {
      await storeEncrypted("routes", "currentRoute", {
        deliveries: updatedAll,
        sessionId,
      });
    } catch {
      // Best effort
    }

    // Queue sync update
    enqueueUpdate({
      deliveryId: delivery.id,
      status: newStatus,
      timestamp: new Date().toISOString(),
    });
  };

  const handleHeadingToRoute = () => {
    updateStatus("in_transit");
  };

  const handleDelivered = () => {
    updateStatus("delivered");
    // Short delay so the user sees the completion state before navigating back
    setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, 600);
  };

  if (loading) {
    return (
      <div className="screen">
        <StatusBar sessionStatus="routes_released" />
        <div className="flex-center flex-1">
          <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
        </div>
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="screen">
        <StatusBar sessionStatus="routes_released" />
        <div className="flex-center flex-1" style={{ padding: 24 }}>
          <div style={{ textAlign: "center" }}>
            <p
              style={{
                fontSize: 18,
                color: "var(--color-text-secondary)",
                marginBottom: 16,
              }}
            >
              {t('driver.delivery.notFound')}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => navigate("/dashboard", { replace: true })}
            >
              {t('driver.delivery.goBack')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusLabel =
    delivery.status === "delivered"
      ? t('driver.delivery.statusDelivered')
      : delivery.status === "in_transit"
        ? t('driver.delivery.statusInTransit')
        : t('driver.delivery.statusPending');

  const statusClass =
    delivery.status === "delivered"
      ? "badge-green"
      : delivery.status === "in_transit"
        ? "badge-orange"
        : "badge-gray";

  return (
    <div className="screen">
      <StatusBar sessionStatus="routes_released" />

      {/* Airplane mode warning */}
      <div className="banner-warning">
        {t('driver.delivery.airplaneWarning')}
      </div>

      {/* Back button */}
      <div style={{ padding: "8px 12px", flexShrink: 0 }}>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "var(--color-primary)",
            fontSize: 15,
            fontWeight: 600,
            padding: "8px 4px",
            cursor: "pointer",
            minHeight: 44,
          }}
          onClick={() => navigate("/dashboard")}
        >
          &#8592; {t('driver.delivery.backToDashboard')}
        </button>
      </div>

      {/* Content */}
      <div className="screen-scroll" style={{ padding: "0 20px 40px" }}>
        {/* Sequence badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--color-primary)",
            borderRadius: 8,
            padding: "8px 16px",
            marginBottom: 20,
          }}
        >
          <span
            style={{
              color: "#fff",
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            #{delivery.sequence}
          </span>
        </div>

        {/* Address */}
        <p className="section-label">{t('driver.delivery.addressLabel')}</p>
        <div className="card-static" style={{ marginBottom: 4 }}>
          <p
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--color-text)",
              lineHeight: 1.5,
            }}
          >
            {delivery.address}
          </p>
        </div>

        {/* Notes */}
        {delivery.notes ? (
          <>
            <p className="section-label">{t('driver.delivery.notesLabel')}</p>
            <div className="card-static" style={{ marginBottom: 4 }}>
              <p
                style={{
                  fontSize: 16,
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {delivery.notes}
              </p>
            </div>
          </>
        ) : null}

        {/* Status */}
        <p className="section-label">{t('driver.delivery.statusLabel')}</p>
        <span
          className={`badge ${statusClass}`}
          style={{ padding: "8px 20px", fontSize: 15 }}
        >
          {statusLabel}
        </span>

        {/* Action buttons */}
        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 16 }}>
          {delivery.status === "pending" && (
            <button
              className="btn btn-warning btn-block"
              style={{ minHeight: 64, fontSize: 20 }}
              onClick={handleHeadingToRoute}
            >
              {t('driver.delivery.headingToRoute')}
            </button>
          )}

          {(delivery.status === "pending" ||
            delivery.status === "in_transit") && (
            <button
              className="btn btn-primary btn-block"
              style={{ minHeight: 64, fontSize: 20 }}
              onClick={handleDelivered}
            >
              {t('driver.delivery.markDelivered')}
            </button>
          )}

          {delivery.status === "delivered" && (
            <div className="banner-success">
              {t('driver.delivery.completed')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
