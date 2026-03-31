/**
 * Full-screen overlay showing a QR code of the session encryption key.
 * Displayed once after route download so the driver can photograph it
 * as a backup for offline key recovery.
 */

import { QRCodeSVG } from "qrcode.react";

interface BackupKeyOverlayProps {
  sessionKey: string;
  onDismiss: () => void;
}

export default function BackupKeyOverlay({
  sessionKey,
  onDismiss,
}: BackupKeyOverlayProps) {
  const qrValue = `safecare-v1:${sessionKey}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 16,
          padding: "32px 24px",
          maxWidth: 360,
          width: "100%",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#1a1a1a",
            margin: "0 0 8px 0",
          }}
        >
          Save Backup Key
        </h2>

        <p
          style={{
            fontSize: 14,
            color: "#666",
            lineHeight: 1.5,
            margin: "0 0 24px 0",
          }}
        >
          Take a photo of this code. If the app closes while you're
          offline, scan it to restore your routes.
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "16px",
            backgroundColor: "#f8f8f8",
            borderRadius: 12,
            marginBottom: 24,
          }}
        >
          <QRCodeSVG
            value={qrValue}
            size={200}
            level="M"
            includeMargin={false}
          />
        </div>

        <button
          onClick={onDismiss}
          style={{
            width: "100%",
            padding: "16px",
            fontSize: 18,
            fontWeight: 700,
            backgroundColor: "var(--color-primary, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            cursor: "pointer",
            minHeight: 56,
          }}
        >
          I've Saved It
        </button>
      </div>
    </div>
  );
}
