import { useOnlineStatus } from "@/lib/hooks";
import { getPendingCount } from "@/lib/sync";

interface StatusBarProps {
  sessionStatus: string;
}

const SESSION_LABELS: Record<string, string> = {
  idle: "Not checked in",
  checked_in: "Checked in — waiting for routes",
  routes_released: "Routes active",
  shift_ended: "Shift ended",
};

export default function StatusBar({ sessionStatus }: StatusBarProps) {
  const isOnline = useOnlineStatus();
  const pendingCount = getPendingCount();

  return (
    <div className="status-bar">
      <span
        className={`status-dot ${isOnline ? "status-dot-online" : "status-dot-offline"}`}
        aria-label={isOnline ? "Online" : "Offline"}
      />

      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-text-secondary)",
        }}
      >
        {isOnline
          ? SESSION_LABELS[sessionStatus] ?? sessionStatus
          : "You are offline — updates will sync when reconnected"}
      </span>

      {pendingCount > 0 && (
        <span
          className="badge badge-orange"
          style={{ fontSize: 12, padding: "2px 8px" }}
        >
          {pendingCount} pending
        </span>
      )}
    </div>
  );
}
