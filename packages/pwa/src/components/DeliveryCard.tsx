type DeliveryStatus = "pending" | "in_transit" | "delivered";

interface Delivery {
  id: string;
  sequence: number;
  address: string;
  notes: string;
  status: DeliveryStatus;
}

interface DeliveryCardProps {
  delivery: Delivery;
  onPress: () => void;
}

const STATUS_CONFIG: Record<
  DeliveryStatus,
  { label: string; className: string }
> = {
  pending: { label: "Pending", className: "badge badge-gray" },
  in_transit: { label: "In Transit", className: "badge badge-orange" },
  delivered: { label: "Delivered", className: "badge badge-green" },
};

export default function DeliveryCard({ delivery, onPress }: DeliveryCardProps) {
  const status = STATUS_CONFIG[delivery.status];

  return (
    <button
      className="card"
      onClick={onPress}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 72,
        marginBottom: 10,
        padding: "12px 14px",
        textAlign: "left",
        cursor: "pointer",
      }}
      aria-label={`Delivery ${delivery.sequence}, ${delivery.address}, ${status.label}`}
    >
      {/* Sequence badge */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          backgroundColor: "var(--color-primary)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        {delivery.sequence}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {delivery.address}
        </div>
        {delivery.notes && (
          <div
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
          >
            {delivery.notes}
          </div>
        )}
      </div>

      {/* Status */}
      <span className={status.className} style={{ flexShrink: 0 }}>
        {status.label}
      </span>
    </button>
  );
}
