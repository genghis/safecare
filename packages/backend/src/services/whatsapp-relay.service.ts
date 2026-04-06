/**
 * WhatsApp relay service — blind communication between drivers and recipients.
 *
 * When a driver needs to contact a recipient (or vice versa), the relay service
 * assigns a pool number as the intermediary. Messages are forwarded through
 * the relay line so neither party sees the other's real phone number.
 *
 * Session lifecycle:
 * 1. Admin releases a route / confirms a shift → relay session created
 * 2. Driver messages relay number → forwarded to recipient
 * 3. Recipient replies to relay number → forwarded to driver
 * 4. Delivery completed / shift expired → session deactivated
 */

import { db } from '../db/index.js';
import { whatsappRelaySessions, whatsappLines } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { whatsappPool } from './whatsapp-pool.service.js';
import { config } from '../config.js';

// In-memory lookup for fast message routing:
// relayLineId:senderJid → { targetPhone, sessionId }
interface RouteEntry {
  targetPhone: string;
  sessionId: string;
}

const routeCache = new Map<string, RouteEntry>();

export class WhatsAppRelayService {
  /**
   * Create a relay session between a driver and recipient.
   * Picks an available relay line from the pool.
   * Returns the relay phone number the driver should message.
   */
  async createSession(opts: {
    driverPhoneEnc: string;
    recipientPhoneEnc: string;
    driverPhone: string;       // decrypted, for route cache
    recipientPhone: string;    // decrypted, for route cache
    dispatchSessionId?: string;
    shiftId?: string;
    ttlHours?: number;
  }): Promise<{ relayPhone: string; sessionId: string } | null> {
    // Find lines currently in use for this dispatch/shift
    const activeSessions = await db
      .select({ whatsappLineId: whatsappRelaySessions.whatsappLineId })
      .from(whatsappRelaySessions)
      .where(eq(whatsappRelaySessions.active, true));

    const busyLineIds = activeSessions.map((s) => s.whatsappLineId);

    // Try to get a line not currently busy
    let relayLine = whatsappPool.getAvailableRelayLine(busyLineIds);

    // If all lines are busy, reuse any connected relay line
    if (!relayLine) {
      relayLine = whatsappPool.getAvailableRelayLine();
    }

    if (!relayLine) {
      return null; // No relay lines available
    }

    const ttlHours = opts.ttlHours ?? 24;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const [session] = await db
      .insert(whatsappRelaySessions)
      .values({
        whatsappLineId: relayLine.id,
        driverPhoneEnc: opts.driverPhoneEnc,
        recipientPhoneEnc: opts.recipientPhoneEnc,
        dispatchSessionId: opts.dispatchSessionId ?? null,
        shiftId: opts.shiftId ?? null,
        expiresAt,
      })
      .returning();

    // Populate route cache for fast message forwarding
    const relayJidPrefix = `${relayLine.id}:`;
    const driverJid = this.phoneToJid(opts.driverPhone);
    const recipientJid = this.phoneToJid(opts.recipientPhone);

    // When driver messages the relay → forward to recipient
    routeCache.set(`${relayJidPrefix}${driverJid}`, {
      targetPhone: opts.recipientPhone,
      sessionId: session.id,
    });

    // When recipient messages the relay → forward to driver
    routeCache.set(`${relayJidPrefix}${recipientJid}`, {
      targetPhone: opts.driverPhone,
      sessionId: session.id,
    });

    const relayPhone = relayLine.phoneNumber
      ? `+${relayLine.phoneNumber}`
      : null;

    return relayPhone
      ? { relayPhone, sessionId: session.id }
      : null;
  }

  /**
   * Handle an incoming message on a relay line.
   * Looks up the route and forwards to the other party.
   */
  async handleIncomingMessage(lineId: string, fromJid: string, text: string): Promise<boolean> {
    const route = routeCache.get(`${lineId}:${fromJid}`);
    if (!route) {
      return false; // No active relay session for this sender
    }

    const result = await whatsappPool.sendOnRelay(lineId, route.targetPhone, text);
    return result.success;
  }

  /**
   * Deactivate all relay sessions for a dispatch session.
   * Called when delivery data is purged.
   */
  async deactivateForDispatch(dispatchSessionId: string): Promise<number> {
    const result = await db
      .update(whatsappRelaySessions)
      .set({ active: false })
      .where(
        and(
          eq(whatsappRelaySessions.dispatchSessionId, dispatchSessionId),
          eq(whatsappRelaySessions.active, true),
        ),
      )
      .returning();

    // Clear route cache entries
    for (const session of result) {
      this.clearCacheForSession(session.id);
    }

    return result.length;
  }

  /**
   * Deactivate a specific relay session.
   */
  async deactivateSession(sessionId: string): Promise<void> {
    await db
      .update(whatsappRelaySessions)
      .set({ active: false })
      .where(eq(whatsappRelaySessions.id, sessionId));

    this.clearCacheForSession(sessionId);
  }

  /**
   * Clean up expired sessions.
   */
  async cleanupExpired(): Promise<number> {
    const result = await db
      .update(whatsappRelaySessions)
      .set({ active: false })
      .where(
        and(
          eq(whatsappRelaySessions.active, true),
          sql`${whatsappRelaySessions.expiresAt} < NOW()`,
        ),
      )
      .returning();

    for (const session of result) {
      this.clearCacheForSession(session.id);
    }

    return result.length;
  }

  private phoneToJid(phone: string): string {
    return `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  private clearCacheForSession(sessionId: string): void {
    for (const [key, entry] of routeCache.entries()) {
      if (entry.sessionId === sessionId) {
        routeCache.delete(key);
      }
    }
  }
}

export const whatsappRelay = new WhatsAppRelayService();

/**
 * Wire up relay message forwarding.
 * Call this once after the pool service is initialized.
 */
export function initRelayForwarding(): void {
  whatsappPool.on('message', async ({ lineId, from, text }: { lineId: string; from: string; text: string }) => {
    await whatsappRelay.handleIncomingMessage(lineId, from, text);
  });
}
