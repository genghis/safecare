"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Rideshare coordination and referral network configuration.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ride Coordination</CardTitle>
            <CardDescription>
              Settings specific to ride scheduling and dispatch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Ride coordination shares the same backend, encryption, and auth
              infrastructure as SafeCare delivery dispatch. Admin accounts,
              driver profiles, and the DEK unlock flow are managed from the
              main SafeCare dashboard.
            </p>
            <p>
              This rideshare dashboard provides focused views for:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Today's asks — unified ride + escort feed</li>
              <li>Shift board — week-ahead view with claim management</li>
              <li>Ride schedules — recurring templates with auto-generation</li>
              <li>Intake queue — multi-channel request processing</li>
              <li>Driver vehicle status — clean/hot/unknown tracking</li>
              <li>Referral directory — vetted provider search</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Referral Network</CardTitle>
            <CardDescription>
              How the vetted referral directory works.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              The referral directory replaces "does anyone know a
              vet/attorney/mechanic" messages in large Signal and WhatsApp groups.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Any admin can add a provider (auto-vouches as creator)</li>
              <li>Providers need 2+ vouches to become "active" and appear in search</li>
              <li>Three vouch levels: personally used, trusted referral, community known</li>
              <li>Search by category, neighborhood, language, and specialty</li>
              <li>All provider PII (name, phone, email, address) is encrypted at rest</li>
              <li>Search history is logged for audit purposes</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Security</CardTitle>
            <CardDescription>
              Encryption and access controls inherited from SafeCare.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <ul className="list-disc list-inside space-y-1">
              <li>Field-level PII encryption (pgcrypto, AES-256)</li>
              <li>DEK never touches disk — loaded from QR at startup</li>
              <li>HMAC-based hash indexing for lookups without decryption</li>
              <li>JWT + TOTP 2FA for admin authentication</li>
              <li>Redis-backed session management with revocation</li>
              <li>Audit logging on all admin actions</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Vehicle Status Guide</CardTitle>
            <CardDescription>
              How to categorize driver vehicles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-green-600 dark:text-green-400">Clean</p>
              <p>Not known to law enforcement or surveillance. Safe for sensitive trips: perinatal care, court, ICE-related appointments, abortion services.</p>
            </div>
            <div>
              <p className="font-medium text-red-600 dark:text-red-400">Hot / Known</p>
              <p>Flagged or associated with mutual aid activity. Still fine for grocery deliveries, but should NOT be used for high-stakes rides.</p>
            </div>
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">Unknown</p>
              <p>Newer drivers or status unverified. Treat as hot until a coordinator confirms otherwise.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
