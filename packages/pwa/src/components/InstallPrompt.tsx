import { useState, useEffect } from "react";
import { useInstallPrompt } from "@/lib/hooks";

const DISMISS_KEY = "safecare_install_dismissed";

export default function InstallPrompt() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY) === "1") {
      setDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  if (!canInstall || dismissed) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "14px 16px",
        paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
        backgroundColor: "var(--color-primary)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 12,
        zIndex: 900,
        boxShadow: "0 -2px 10px rgba(0,0,0,0.15)",
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        Add SafeCare to your home screen for offline access
      </span>
      <button
        onClick={promptInstall}
        style={{
          background: "#fff",
          color: "var(--color-primary)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          padding: "10px 16px",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        style={{
          background: "transparent",
          color: "rgba(255,255,255,0.8)",
          border: "none",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
          padding: "10px 4px",
        }}
      >
        Not now
      </button>
    </div>
  );
}
