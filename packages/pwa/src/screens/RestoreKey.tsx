/**
 * QR code scanner screen for offline key recovery.
 *
 * Shown when: encrypted data exists in IndexedDB but the session key
 * has been lost (tab closed, browser killed) and the server is unreachable.
 * The driver scans a photo of the QR code shown after route download.
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { deriveKey, storeSessionKey } from "@/lib/crypto";
import { purgeAll } from "@/lib/db";
import { clearToken } from "@/lib/api";
import { clearTileCache } from "@/lib/tile-cache";
import { useLocale } from "@/lib/locale";

const QR_PREFIX = "safecare-v1:";
const SCANNER_ID = "qr-scanner-region";

export default function RestoreKey() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup scanner on unmount
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const startScanning = async () => {
    setError("");
    setScanning(true);

    try {
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          // Stop scanning immediately on successful decode
          await scanner.stop();
          scannerRef.current = null;
          setScanning(false);

          if (!decodedText.startsWith(QR_PREFIX)) {
            setError(t('driver.restore.errorInvalidQr'));
            return;
          }

          const sessionKey = decodedText.slice(QR_PREFIX.length);
          if (sessionKey.length !== 64 || !/^[0-9a-f]+$/i.test(sessionKey)) {
            setError(t('driver.restore.errorInvalidKey'));
            return;
          }

          try {
            await deriveKey(sessionKey);
            storeSessionKey(sessionKey);
            navigate("/dashboard", { replace: true });
          } catch {
            setError(t('driver.restore.errorRestore'));
          }
        },
        () => {
          // QR code not detected in this frame — ignore
        },
      );
    } catch {
      setScanning(false);
      setError(t('driver.restore.errorCamera'));
    }
  };

  const handleSkip = async () => {
    // Purge everything and go to login
    try {
      await purgeAll();
      clearToken();
      await clearTileCache();
    } catch {
      // best effort
    }
    navigate("/", { replace: true });
  };

  return (
    <div
      className="screen"
      style={{
        justifyContent: "center",
        padding: "0 24px",
        overflow: "auto",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "var(--color-text)",
            margin: "0 0 8px 0",
          }}
        >
          {t('driver.restore.title')}
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--color-text-secondary)",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {t('driver.restore.description')}
        </p>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: "var(--color-danger-light, #fee2e2)",
            color: "var(--color-danger, #dc2626)",
            padding: "12px 16px",
            borderRadius: "var(--radius-md, 8px)",
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {/* Scanner viewport */}
      <div
        id={SCANNER_ID}
        style={{
          width: "100%",
          maxWidth: 320,
          margin: "0 auto 24px",
          borderRadius: 12,
          overflow: "hidden",
          minHeight: scanning ? 320 : 0,
        }}
      />

      {!scanning && (
        <button
          className="btn btn-primary btn-block"
          style={{ minHeight: 56, fontSize: 18, marginBottom: 16 }}
          onClick={startScanning}
        >
          {t('driver.restore.scanQr')}
        </button>
      )}

      <button
        style={{
          display: "block",
          margin: "8px auto 0",
          padding: "14px 16px",
          color: "var(--color-danger, #dc2626)",
          fontSize: 15,
          fontWeight: 600,
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
        onClick={handleSkip}
      >
        {t('driver.restore.skipFresh')}
      </button>

      <p
        style={{
          fontSize: 12,
          color: "var(--color-text-muted, #999)",
          textAlign: "center",
          marginTop: 8,
          lineHeight: 1.4,
        }}
      >
        {t('driver.restore.skipWarning')}
      </p>
    </div>
  );
}
