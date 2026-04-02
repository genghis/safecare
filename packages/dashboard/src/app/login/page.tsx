"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiPost, setToken } from "@/lib/api";
import { useLocale } from "@/lib/locale";

type LoginResponse = {
  token?: string;
  requiresTotp?: boolean;
  tempToken?: string;
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="animate-pulse text-muted-foreground">Loading...</div></div>}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // TOTP step state
  const [totpStep, setTotpStep] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const restored = searchParams.get("restored") === "1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await apiPost<LoginResponse>("/api/auth/admin/login", {
      email,
      password,
    });

    if (res.ok && res.data?.requiresTotp && res.data?.tempToken) {
      setTempToken(res.data.tempToken);
      setTotpStep(true);
    } else if (res.ok && res.data?.token) {
      setToken(res.data.token);
      router.push("/");
    } else {
      setError(res.error || t('dashboard.login.invalidCredentials'));
    }

    setLoading(false);
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await apiPost<{ token: string }>(
      "/api/auth/admin/verify-totp",
      { tempToken, totpCode },
    );

    if (res.ok && res.data?.token) {
      setToken(res.data.token);
      router.push("/");
    } else {
      setError(res.error || t('dashboard.login.invalidCode'));
    }

    setLoading(false);
  }

  if (totpStep) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
              SC
            </div>
            <CardTitle className="text-2xl">{t('dashboard.login.totpTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              {t('dashboard.login.totpSubtitle')}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="totpCode" className="text-sm font-medium">
                  {t('dashboard.login.authCode')}
                </label>
                <Input
                  id="totpCode"
                  type="text"
                  inputMode="text"
                  pattern="(\\d{6}|[a-fA-F0-9]{8})"
                  maxLength={8}
                  placeholder="000000 or a1b2c3d4"
                  value={totpCode}
                  onChange={(e) =>
                    setTotpCode(
                      e.target.value
                        .replace(/[^a-fA-F0-9]/g, "")
                        .slice(0, 8)
                        .toLowerCase()
                    )
                  }
                  autoFocus
                  required
                  className="text-center text-2xl tracking-widest font-mono"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={
                  loading ||
                  !(/^(\d{6}|[a-f0-9]{8})$/.test(totpCode))
                }
              >
                {loading ? t('dashboard.settings.verifying') : t('dashboard.login.verify')}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setTotpStep(false);
                  setTotpCode("");
                  setTempToken("");
                  setError("");
                }}
              >
                {t('dashboard.login.backToLogin')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
            SC
          </div>
          <CardTitle className="text-2xl">{t('dashboard.login.title')}</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {t('dashboard.login.subtitle')}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {restored && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Backup restored. Sign in with your existing SafeCare admin account to continue setup on this machine.
              </div>
            )}
            {error && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                {t('dashboard.login.emailLabel')}
              </label>
              <Input
                id="email"
                type="email"
                placeholder={t('dashboard.login.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t('dashboard.login.passwordLabel')}
              </label>
              <Input
                id="password"
                type="password"
                placeholder={t('dashboard.login.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('dashboard.login.signingIn') : t('dashboard.login.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
