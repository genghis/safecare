"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiPost, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await apiPost<any>("/api/auth/admin/login", { email, password });
    setLoading(false);

    if (!res.ok) {
      setError(res.error ?? "Invalid credentials");
      return;
    }

    if (res.data?.requiresTotp) {
      setTempToken(res.data.tempToken);
      return;
    }

    if (res.data?.token) {
      setToken(res.data.token);
      router.replace("/");
    }
  };

  const handleTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await apiPost<any>("/api/auth/admin/totp/verify", {
      tempToken,
      totpCode,
    });
    setLoading(false);

    if (!res.ok) {
      setError(res.error ?? "Invalid verification code");
      return;
    }

    if (res.data?.token) {
      setToken(res.data.token);
      router.replace("/");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-lg">
            RS
          </div>
          <CardTitle className="text-2xl">RideShare</CardTitle>
          <CardDescription>
            {tempToken
              ? "Enter your 2FA verification code"
              : "Mutual aid ride coordination"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tempToken ? (
            <form onSubmit={handleTotp} className="space-y-4">
              <div>
                <Input
                  placeholder="6-digit code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  autoFocus
                  maxLength={8}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Verifying..." : "Verify"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
