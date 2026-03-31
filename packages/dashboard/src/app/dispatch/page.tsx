"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost } from "@/lib/api";
import { useLocale } from "@/lib/locale";

interface DispatchSession {
  id: string;
  date: string;
  status: "draft" | "active" | "released" | "completed";
  createdAt: string;
  releasedAt?: string;
}

interface DriverCheckIn {
  id: string;
  driverId: string;
  driverName: string;
  checkedInAt: string;
  vehicle: string;
  selected: boolean;
}

interface DeliveryStatus {
  id: string;
  recipientName: string;
  driverName: string;
  status: string;
  address: string;
  updatedAt: string;
}

const AUTO_REFRESH_INTERVAL = 10_000;

export default function DispatchPage() {
  const { t } = useLocale();
  const [session, setSession] = useState<DispatchSession | null>(null);
  const [checkIns, setCheckIns] = useState<DriverCheckIn[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [revokingDriver, setRevokingDriver] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSession = useCallback(async () => {
    const res = await apiGet<{
      session: DispatchSession | null;
      checkIns: DriverCheckIn[];
      deliveries: DeliveryStatus[];
    }>("/api/dispatch/sessions/active");

    if (res.ok && res.data) {
      setSession(res.data.session);
      setCheckIns(
        (res.data.checkIns || []).map((c) => ({ ...c, selected: true }))
      );
      setDeliveries(res.data.deliveries || []);
    }
    setLoading(false);
    setLastRefreshed(new Date());
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Auto-refresh every 10 seconds when a session is active
  useEffect(() => {
    if (session && session.status !== "completed") {
      refreshTimerRef.current = setInterval(() => {
        fetchSession();
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [session?.id, session?.status, fetchSession]);

  async function handleCreateSession() {
    setCreating(true);
    const res = await apiPost<DispatchSession>(
      "/api/dispatch/sessions",
      { date: sessionDate }
    );
    if (res.ok && res.data) {
      setSession(res.data);
      setCheckIns([]);
      setDeliveries([]);
    }
    setCreating(false);
  }

  async function handleReleaseRoutes() {
    if (!session) return;
    setReleasing(true);

    const selectedDriverIds = checkIns
      .filter((c) => c.selected)
      .map((c) => c.driverId);

    const res = await apiPost<{ session: DispatchSession }>(
      `/api/dispatch/sessions/${session.id}/release`,
      { driverIds: selectedDriverIds }
    );

    if (res.ok) {
      await fetchSession();
    }
    setReleasing(false);
  }

  async function handleRevokeDriver(driverId: string, driverName: string) {
    if (!session) return;
    if (!confirm(t('dashboard.dispatch.revokeConfirm', { name: driverName }))) return;

    setRevokingDriver(driverId);
    const res = await apiPost(
      `/api/dispatch/sessions/${session.id}/revoke-driver`,
      { driverId }
    );
    if (res.ok) {
      await fetchSession();
    }
    setRevokingDriver(null);
  }

  function toggleDriver(id: string) {
    setCheckIns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  }

  function selectAll() {
    setCheckIns((prev) => prev.map((c) => ({ ...c, selected: true })));
  }

  function selectNone() {
    setCheckIns((prev) => prev.map((c) => ({ ...c, selected: false })));
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-8">{t('dashboard.dispatch.title')}</h1>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          {t('dashboard.dispatch.loadingData')}
        </div>
      </div>
    );
  }

  const selectedCount = checkIns.filter((c) => c.selected).length;

  // Delivery status breakdown counts
  const statusCounts = {
    pending: deliveries.filter((d) => d.status === "pending").length,
    in_transit: deliveries.filter((d) => d.status === "in_transit").length,
    delivered: deliveries.filter((d) => d.status === "delivered").length,
    acknowledged: deliveries.filter((d) => d.status === "acknowledged").length,
  };
  const totalDeliveries = deliveries.length;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.dispatch.title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('dashboard.dispatch.subtitle')}
          </p>
        </div>
        {session && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
              aria-hidden="true"
            />
            {t('dashboard.dispatch.autoRefreshing')} &middot; {t('dashboard.dispatch.lastUpdated')}{" "}
            {lastRefreshed.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Create New Session */}
      {!session && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{t('dashboard.dispatch.createNewSession')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <label
                htmlFor="session-date"
                className="text-sm font-medium text-foreground"
              >
                {t('dashboard.dispatch.sessionDate')}
              </label>
              <Input
                id="session-date"
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className="max-w-[200px]"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleCreateSession} disabled={creating}>
              {creating ? t('dashboard.dispatch.creating') : t('dashboard.dispatch.createNewSession')}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Active Session */}
      {session && (
        <>
          {/* Session Info Bar */}
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-lg">{t('dashboard.dispatch.sessionStatus')}</CardTitle>
              <StatusBadge status={session.status} />
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    {t('dashboard.dispatch.sessionId')}
                  </span>
                  <p className="text-sm font-mono">{session.id.slice(0, 8)}...</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t('dashboard.dispatch.date')}</span>
                  <p className="text-sm">
                    {new Date(session.date || session.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t('dashboard.dispatch.created')}</span>
                  <p className="text-sm">
                    {new Date(session.createdAt).toLocaleString()}
                  </p>
                </div>
                {session.releasedAt && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      {t('dashboard.dispatch.released')}
                    </span>
                    <p className="text-sm">
                      {new Date(session.releasedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Delivery Status Overview */}
          <div className="mb-6 grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-500">
                    {statusCounts.pending}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{t('dashboard.common.pending')}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-500">
                    {statusCounts.in_transit}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('dashboard.common.inTransit')}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-emerald-600">
                    {statusCounts.delivered}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('dashboard.common.delivered')}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-purple-600">
                    {statusCounts.acknowledged}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('dashboard.common.acknowledged')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recipient Notifications */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t('dashboard.dispatch.recipientNotifications')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {t('dashboard.dispatch.recipientNotificationsDesc')}
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{t('dashboard.dispatch.enRouteNotification')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('dashboard.dispatch.enRouteNotificationDesc')}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">
                      {t('dashboard.dispatch.deliveredNotification')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('dashboard.dispatch.deliveredNotificationDesc')}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Driver Check-ins */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {t('dashboard.dispatch.driverCheckIns')}
                    {checkIns.length > 0 && (
                      <Badge variant="success" className="ml-2">
                        {checkIns.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={selectAll}>
                      {t('dashboard.dispatch.selectAll')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={selectNone}>
                      {t('dashboard.dispatch.clear')}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {checkIns.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t('dashboard.dispatch.noCheckIns')}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {checkIns.map((checkIn) => (
                      <div
                        key={checkIn.id}
                        className={`flex items-center justify-between rounded-md border p-3 cursor-pointer transition-colors ${
                          checkIn.selected
                            ? "border-primary bg-accent/50"
                            : "border-border hover:bg-accent/30"
                        }`}
                        onClick={() => toggleDriver(checkIn.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-4 w-4 rounded border flex items-center justify-center ${
                              checkIn.selected
                                ? "bg-primary border-primary"
                                : "border-muted-foreground"
                            }`}
                          >
                            {checkIn.selected && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              {checkIn.driverName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {checkIn.vehicle || t('dashboard.dispatch.noVehicleInfo')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {new Date(checkIn.checkedInAt).toLocaleTimeString()}
                          </span>
                          {session.status === "active" && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={revokingDriver === checkIn.driverId}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevokeDriver(checkIn.driverId, checkIn.driverName);
                              }}
                            >
                              {revokingDriver === checkIn.driverId ? t('dashboard.dispatch.revoking') : t('dashboard.dispatch.revoke')}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
              {checkIns.length > 0 && session.status === "draft" && (
                <CardFooter>
                  <Button
                    onClick={handleReleaseRoutes}
                    disabled={releasing || selectedCount === 0}
                    className="w-full"
                  >
                    {releasing
                      ? t('dashboard.dispatch.releasingRoutes')
                      : t('dashboard.dispatch.approveAndRelease', { count: String(selectedCount), plural: selectedCount !== 1 ? "s" : "" })}
                  </Button>
                </CardFooter>
              )}
            </Card>

            {/* Delivery Progress */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{t('dashboard.dispatch.deliveryProgress')}</CardTitle>
                  {totalDeliveries > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {statusCounts.delivered + statusCounts.acknowledged}/
                      {totalDeliveries}
                    </span>
                  )}
                </div>
                {totalDeliveries > 0 && (
                  <div className="w-full bg-muted rounded-full h-2 mt-2">
                    <div
                      className="bg-emerald-600 h-2 rounded-full transition-all"
                      style={{
                        width: `${
                          totalDeliveries > 0
                            ? ((statusCounts.delivered +
                                statusCounts.acknowledged) /
                                totalDeliveries) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {deliveries.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {session.status === "active"
                      ? t('dashboard.dispatch.deliveriesAfterRelease')
                      : t('dashboard.dispatch.noDeliveries')}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {deliveries.map((delivery) => (
                      <div
                        key={delivery.id}
                        className="flex items-center justify-between rounded-md border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {delivery.recipientName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {delivery.address}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('dashboard.dispatch.driver', { name: delivery.driverName })}
                          </p>
                        </div>
                        <div className="ml-3 flex-shrink-0">
                          <StatusBadge status={delivery.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
