import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db/index.js';
import {
  dispatchSessions,
  deliveries,
  driverCheckIns,
  downloadTokens,
  auditLog,
  recipients,
} from '../db/schema.js';
import { config } from '../config.js';
import type {
  DispatchStatus,
  RoutePacket,
  DriverSyncPayload,
} from '@safecare/shared';
import {
  generateDownloadToken,
  DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES,
} from '@safecare/shared';

export interface CreateSessionInput {
  date: string;
  createdBy: string;
  strictnessLevel?: string;
  downloadTokenTtlMinutes?: number;
  routeDataTtlHours?: number;
}

export class DispatchService {
  /**
   * Create a new dispatch session.
   */
  async createSession(data: CreateSessionInput) {
    const result = await db
      .insert(dispatchSessions)
      .values({
        date: data.date,
        createdBy: data.createdBy,
        strictnessLevel: data.strictnessLevel ?? 'standard',
        downloadTokenTtlMinutes:
          data.downloadTokenTtlMinutes ?? DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES,
        routeDataTtlHours: data.routeDataTtlHours ?? 8,
      })
      .returning();

    return result[0];
  }

  /**
   * Get a dispatch session by id, including its check-ins.
   */
  async getSession(id: string) {
    const session = await db
      .select()
      .from(dispatchSessions)
      .where(eq(dispatchSessions.id, id));

    if (!session[0]) return null;

    const checkIns = await db
      .select()
      .from(driverCheckIns)
      .where(eq(driverCheckIns.dispatchSessionId, id));

    return { ...session[0], checkIns };
  }

  /**
   * Get the current active dispatch session.
   */
  async getActiveSession() {
    const rows = await db
      .select()
      .from(dispatchSessions)
      .where(eq(dispatchSessions.status, 'active'));

    return rows[0] ?? null;
  }

  /**
   * Assign drivers to deliveries within a session.
   */
  async assignDeliveries(
    sessionId: string,
    assignments: Array<{ deliveryId: string; driverId: string }>,
  ) {
    const results = [];

    for (const { deliveryId, driverId } of assignments) {
      const result = await db
        .update(deliveries)
        .set({
          driverId,
          dispatchSessionId: sessionId,
          status: 'assigned',
        })
        .where(eq(deliveries.id, deliveryId))
        .returning();

      results.push(result[0]);
    }

    // Update session status to ready
    await db
      .update(dispatchSessions)
      .set({ status: 'ready' })
      .where(eq(dispatchSessions.id, sessionId));

    return results;
  }

  /**
   * Record a driver check-in for a dispatch session.
   */
  async driverCheckIn(driverId: string, sessionId: string) {
    // Check for existing check-in
    const existing = await db
      .select()
      .from(driverCheckIns)
      .where(
        and(
          eq(driverCheckIns.driverId, driverId),
          eq(driverCheckIns.dispatchSessionId, sessionId),
        ),
      );

    if (existing.length > 0) {
      return existing[0];
    }

    const result = await db
      .insert(driverCheckIns)
      .values({ driverId, dispatchSessionId: sessionId })
      .returning();

    return result[0];
  }

  /**
   * Release routes to specified drivers: generate download tokens and mark releases.
   */
  async releaseRoutes(sessionId: string, driverIds: string[]) {
    const tokens: Array<{ driverId: string; token: string; expiresAt: Date }> =
      [];

    // Get session for TTL
    const session = await db
      .select()
      .from(dispatchSessions)
      .where(eq(dispatchSessions.id, sessionId));

    const ttlMinutes =
      session[0]?.downloadTokenTtlMinutes ?? DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES;

    for (const driverId of driverIds) {
      const rawToken = generateDownloadToken();
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      await db.insert(downloadTokens).values({
        driverId,
        dispatchSessionId: sessionId,
        tokenHash,
        expiresAt,
      });

      // Mark check-in as route released
      await db
        .update(driverCheckIns)
        .set({ routeReleasedAt: new Date() })
        .where(
          and(
            eq(driverCheckIns.driverId, driverId),
            eq(driverCheckIns.dispatchSessionId, sessionId),
          ),
        );

      // Mark deliveries as released
      await db
        .update(deliveries)
        .set({ status: 'released', releasedAt: new Date() })
        .where(
          and(
            eq(deliveries.driverId, driverId),
            eq(deliveries.dispatchSessionId, sessionId),
          ),
        );

      tokens.push({ driverId, token: rawToken, expiresAt });
    }

    // Update session status to active
    await db
      .update(dispatchSessions)
      .set({ status: 'active' })
      .where(eq(dispatchSessions.id, sessionId));

    return tokens;
  }

  /**
   * Validate a download token and return the route packet. Marks token as used.
   */
  async downloadRoute(token: string): Promise<RoutePacket | null> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const rows = await db
      .select()
      .from(downloadTokens)
      .where(eq(downloadTokens.tokenHash, tokenHash));

    const tokenRecord = rows[0];
    if (!tokenRecord) return null;
    if (tokenRecord.used) return null;
    if (new Date() > tokenRecord.expiresAt) return null;

    // Mark token as used
    await db
      .update(downloadTokens)
      .set({ used: true })
      .where(eq(downloadTokens.id, tokenRecord.id));

    // Mark check-in as downloaded
    await db
      .update(driverCheckIns)
      .set({ routeDownloadedAt: new Date() })
      .where(
        and(
          eq(driverCheckIns.driverId, tokenRecord.driverId),
          eq(driverCheckIns.dispatchSessionId, tokenRecord.dispatchSessionId),
        ),
      );

    // Fetch deliveries for this driver + session with decrypted addresses
    const stops = await db
      .select({
        deliveryId: deliveries.id,
        address: sql<string>`pgp_sym_decrypt(${deliveries.addressEnc}::bytea, ${config.DEK})`,
        lat: deliveries.lat,
        lng: deliveries.lng,
        notes: deliveries.notes,
        recipientName: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
      })
      .from(deliveries)
      .leftJoin(recipients, eq(deliveries.recipientId, recipients.id))
      .where(
        and(
          eq(deliveries.driverId, tokenRecord.driverId),
          eq(deliveries.dispatchSessionId, tokenRecord.dispatchSessionId),
        ),
      );

    // Get session for TTL
    const session = await db
      .select()
      .from(dispatchSessions)
      .where(eq(dispatchSessions.id, tokenRecord.dispatchSessionId));

    const ttlHours = session[0]?.routeDataTtlHours ?? 8;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    return {
      sessionId: tokenRecord.dispatchSessionId,
      driverId: tokenRecord.driverId,
      stops: stops.map((s, i) => ({
        deliveryId: s.deliveryId,
        address: s.address ?? '',
        lat: parseFloat(s.lat ?? '0'),
        lng: parseFloat(s.lng ?? '0'),
        notes: s.notes ?? '',
        recipientName: s.recipientName ?? '',
        sequence: i + 1,
      })),
      expiresAt,
    };
  }

  /**
   * Record a delivery as completed.
   */
  async recordDelivery(deliveryId: string, timestamp: Date) {
    const result = await db
      .update(deliveries)
      .set({ status: 'delivered', deliveredAt: timestamp })
      .where(eq(deliveries.id, deliveryId))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Process offline sync updates from a driver.
   */
  async syncDriverUpdates(payload: DriverSyncPayload) {
    const results = [];

    for (const update of payload.updates) {
      const result = await db
        .update(deliveries)
        .set({
          status: update.status,
          deliveredAt:
            update.status === 'delivered' ? update.timestamp : undefined,
        })
        .where(
          and(
            eq(deliveries.id, update.deliveryId),
            eq(deliveries.driverId, payload.driverId),
          ),
        )
        .returning();

      results.push(result[0]);
    }

    return results;
  }

  /**
   * Record that a driver has confirmed local data purge.
   */
  async confirmPurge(driverId: string, sessionId: string) {
    const result = await db
      .update(driverCheckIns)
      .set({ purgeConfirmedAt: new Date() })
      .where(
        and(
          eq(driverCheckIns.driverId, driverId),
          eq(driverCheckIns.dispatchSessionId, sessionId),
        ),
      )
      .returning();

    // Create audit record
    const sessionDeliveries = await db
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.driverId, driverId),
          eq(deliveries.dispatchSessionId, sessionId),
        ),
      );

    const completedCount = sessionDeliveries.filter(
      (d) => d.status === 'delivered',
    ).length;

    await db.insert(auditLog).values({
      driverId,
      action: 'purge_confirmed',
      stopCount: sessionDeliveries.length,
      completedCount,
      releasedAt: sessionDeliveries[0]?.releasedAt,
      purgedAt: new Date(),
    });

    return result[0] ?? null;
  }
}

export const dispatchService = new DispatchService();
