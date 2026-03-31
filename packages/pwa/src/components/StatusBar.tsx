import { useState, useEffect } from "react";
import { useOnlineStatus } from "@/lib/hooks";
import { getPendingCount } from "@/lib/sync";
import { useLocale } from "@/lib/locale";

interface StatusBarProps {
  sessionStatus: string;
}

export default function StatusBar({ sessionStatus }: StatusBarProps) {
  const { t } = useLocale();
  const isOnline = useOnlineStatus();

  const SESSION_LABELS: Record<string, string> = {
    idle: t('driver.status.idle'),
    checked_in: t('driver.statusBar.checkedIn'),
    routes_released: t('driver.statusBar.routesActive'),
    shift_ended: t('driver.statusBar.shiftEnded'),
  };
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    getPendingCount().then(setPendingCount);
    const interval = setInterval(() => {
      getPendingCount().then(setPendingCount);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="status-bar">
      <span
        className={`status-dot ${isOnline ? "status-dot-online" : "status-dot-offline"}`}
        aria-label={isOnline ? t('driver.statusBar.online') : t('driver.statusBar.offline')}
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
          : t('driver.statusBar.offlineMessage')}
      </span>

      {pendingCount > 0 && (
        <span
          className="badge badge-orange"
          style={{ fontSize: 12, padding: "2px 8px" }}
        >
          {t('driver.statusBar.pending', { count: String(pendingCount) })}
        </span>
      )}
    </div>
  );
}
