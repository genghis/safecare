"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { useLocale } from "@/lib/locale";

const QR_PREFIX = "safecare-dek:";

export default function UnlockPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [manualKey, setManualKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Check if system is actually locked
  useEffect(() => {
    async function checkStatus() {
      const res = await apiGet<any>("/api/setup/status");
      if (res.ok && !res.data?.locked) {
        // Already unlocked — go to dashboard or setup
        if (res.data?.setupComplete) {
          router.push("/");
        } else {
          router.push("/setup");
        }
        return;
      }
      setChecking(false);
    }
    checkStatus();
  }, [router]);

  // Start camera for QR scanning
  useEffect(() => {
    if (checking || mode !== "scan") return;

    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // Poll for QR codes using BarcodeDetector if available
        if ("BarcodeDetector" in window) {
          const detector = new (window as any).BarcodeDetector({
            formats: ["qr_code"],
          });
          scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              for (const barcode of barcodes) {
                if (barcode.rawValue?.startsWith(QR_PREFIX)) {
                  const dek = barcode.rawValue.slice(QR_PREFIX.length);
                  stopCamera();
                  await submitKey(dek);
                  return;
                }
              }
            } catch {
              // Detection frame error — non-fatal
            }
          }, 500);
        }
      } catch {
        // Camera not available — switch to manual
        setMode("manual");
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [checking, mode]);

  function stopCamera() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function submitKey(dek: string) {
    if (!/^[0-9a-f]{64}$/i.test(dek)) {
      setError(t('dashboard.unlock.invalidKeyFormat'));
      return;
    }

    setError("");
    setLoading(true);

    const res = await apiPost<any>("/api/setup/unlock", { dek });

    if (res.ok) {
      // Check if setup is complete to decide where to go
      const statusRes = await apiGet<any>("/api/setup/status");
      if (statusRes.ok && statusRes.data?.setupComplete) {
        router.push("/");
      } else {
        router.push("/setup");
      }
    } else {
      setError(
        res.error || t('dashboard.unlock.invalidKey')
      );
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">{t('dashboard.common.checking')}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <CardTitle className="text-2xl">{t('dashboard.unlock.title')}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('dashboard.unlock.subtitle')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive">
              {error}
            </div>
          )}

          {mode === "scan" && (
            <>
              <div className="overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  className="w-full"
                  playsInline
                  muted
                  style={{ minHeight: 280 }}
                />
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <p className="text-center text-xs text-muted-foreground">
                {t('dashboard.unlock.cameraPrompt')}
              </p>
              <button
                onClick={() => {
                  stopCamera();
                  setMode("manual");
                }}
                data-testid="unlock-manual-toggle"
                className="w-full text-center text-sm font-medium text-primary hover:underline"
              >
                {t('dashboard.unlock.enterManually')}
              </button>
            </>
          )}

          {mode === "manual" && (
            <>
              <div>
                <label
                  htmlFor="dek-input"
                  className="mb-2 block text-sm font-medium"
                >
                  {t('dashboard.unlock.encryptionKeyLabel')}
                </label>
                <Input
                  id="dek-input"
                  data-testid="unlock-manual-key"
                  type="text"
                  placeholder="a1b2c3d4..."
                  value={manualKey}
                  onChange={(e) =>
                    setManualKey(
                      e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 64)
                    )
                  }
                  className="font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('dashboard.unlock.characters', { count: String(manualKey.length) })}
                </p>
              </div>
              <Button
                onClick={() => submitKey(manualKey)}
                disabled={manualKey.length !== 64 || loading}
                className="w-full"
                data-testid="unlock-submit"
              >
                {loading ? t('dashboard.unlock.unlocking') : t('dashboard.unlock.unlock')}
              </Button>
              <button
                onClick={() => setMode("scan")}
                className="w-full text-center text-sm font-medium text-primary hover:underline"
              >
                {t('dashboard.unlock.scanQr')}
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
