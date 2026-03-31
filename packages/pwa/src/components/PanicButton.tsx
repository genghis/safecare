/**
 * Emergency erase button. Long-press (500ms) to instantly destroy all
 * local data — IndexedDB, sessionStorage, tile cache, JWT.
 *
 * No network calls, no confirmation dialog, no waiting. Fire-and-forget
 * for maximum speed in high-threat situations.
 */

import { useRef, useState, useCallback } from "react";
import { emergencyPurge } from "@/lib/db";
import { useLocale } from "@/lib/locale";

const HOLD_DURATION_MS = 500;

interface PanicButtonProps {
  onPurged?: () => void;
}

export default function PanicButton({ onPurged }: PanicButtonProps) {
  const { t } = useLocale();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHold = useCallback(() => {
    setHolding(true);
    setProgress(0);

    // Animate progress bar
    const startTime = Date.now();
    animRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setProgress(Math.min(elapsed / HOLD_DURATION_MS, 1));
    }, 16);

    // Trigger after hold duration
    timerRef.current = setTimeout(async () => {
      if (animRef.current) clearInterval(animRef.current);
      setProgress(1);

      await emergencyPurge();

      if (onPurged) {
        onPurged();
      } else {
        window.location.replace("/");
      }
    }, HOLD_DURATION_MS);
  }, [onPurged]);

  const cancelHold = useCallback(() => {
    setHolding(false);
    setProgress(0);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (animRef.current) {
      clearInterval(animRef.current);
      animRef.current = null;
    }
  }, []);

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
      aria-label={t('driver.panic.ariaLabel')}
      style={{
        position: "relative",
        overflow: "hidden",
        minWidth: 56,
        minHeight: 56,
        padding: "12px 16px",
        fontSize: 13,
        fontWeight: 800,
        color: holding ? "#fff" : "var(--color-danger, #dc2626)",
        backgroundColor: holding
          ? "var(--color-danger, #dc2626)"
          : "transparent",
        border: "2px solid var(--color-danger, #dc2626)",
        borderRadius: 12,
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
        transition: "background-color 0.15s, color 0.15s",
      }}
    >
      {/* Progress fill */}
      {holding && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.2)",
            transformOrigin: "left",
            transform: `scaleX(${progress})`,
            transition: "none",
          }}
        />
      )}
      <span style={{ position: "relative", zIndex: 1 }}>
        {holding ? t('driver.panic.erasing') : t('driver.panic.erase')}
      </span>
    </button>
  );
}
