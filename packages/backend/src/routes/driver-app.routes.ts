import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { dispatchService } from '../services/dispatch.service.js';
import { routingService } from '../services/routing.service.js';
import { notificationService } from '../services/notification.service.js';
import { db } from '../db/index.js';
import { deliveries, recipients, downloadTokens } from '../db/schema.js';
import crypto from 'crypto';
import { config } from '../config.js';
import { RATE_LIMIT_DRIVER_RPM } from '@safecare/shared';
import type { DriverSyncPayload } from '@safecare/shared';
import type { RecipientContact } from '../services/notification.service.js';

const downloadRouteSchema = z.object({
  token: z.string().min(1),
  driverLat: z.number().optional(),
  driverLng: z.number().optional(),
});

const syncSchema = z.object({
  updates: z.array(
    z.object({
      deliveryId: z.string().uuid(),
      status: z.enum([
        'pending',
        'assigned',
        'released',
        'in_transit',
        'delivered',
        'acknowledged',
        'failed',
      ]),
      timestamp: z.coerce.date(),
    }),
  ),
});

const purgeConfirmSchema = z.object({
  sessionId: z.string().uuid(),
});

export default async function driverAppRoutes(fastify: FastifyInstance) {
  // Apply stricter rate limiting to all driver-facing routes
  fastify.register(
    async function driverRateLimited(scoped) {
      await scoped.register(import('@fastify/rate-limit'), {
        max: RATE_LIMIT_DRIVER_RPM,
        timeWindow: '1 minute',
      });

      /**
       * POST /api/driver/check-in
       * Driver checks in for the active dispatch session.
       */
      scoped.post(
        '/api/driver/check-in',
        { preHandler: [fastify.requireDriver] },
        async (request: FastifyRequest, reply: FastifyReply) => {
          const driverId = request.user.sub;

          const session = await dispatchService.getActiveSession();
          if (!session) {
            return reply.code(404).send({
              success: false,
              error: 'No active dispatch session',
            });
          }

          const checkIn = await dispatchService.driverCheckIn(
            driverId,
            session.id,
          );

          return reply.send({
            success: true,
            data: checkIn,
          });
        },
      );

      /**
       * GET /api/driver/status
       * Poll for route release status. Driver can check whether their route has been released.
       */
      scoped.get(
        '/api/driver/status',
        { preHandler: [fastify.requireDriver] },
        async (request: FastifyRequest, reply: FastifyReply) => {
          const driverId = request.user.sub;

          const session = await dispatchService.getActiveSession();
          if (!session) {
            return reply.send({
              success: true,
              data: { sessionActive: false, routeReleased: false },
            });
          }

          // Check if the driver has a check-in with a route release
          const sessionData = await dispatchService.getSession(session.id);
          const checkIn = sessionData?.checkIns.find(
            (c) => c.driverId === driverId,
          );

          // If route is released, always provide a download token
          // (drivers may need to re-download if app crashes or page refreshes)
          let downloadToken: string | undefined;
          if (checkIn?.routeReleasedAt) {
            const { generateDownloadToken } = await import('@safecare/shared');
            const token = generateDownloadToken();
            const tokenHash = crypto
              .createHash('sha256')
              .update(token)
              .digest('hex');

            await db.insert(downloadTokens).values({
              driverId,
              dispatchSessionId: session.id,
              tokenHash,
              expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
            });

            downloadToken = token;
          }

          // Check if session has been revoked by admin
          const revoked = checkIn
            ? await dispatchService.isSessionRevoked(driverId, session.id)
            : false;

          return reply.send({
            success: true,
            data: {
              sessionActive: true,
              sessionId: session.id,
              checkedIn: !!checkIn,
              routeReleased: !!checkIn?.routeReleasedAt,
              routeDownloaded: !!checkIn?.routeDownloadedAt,
              purgeConfirmed: !!checkIn?.purgeConfirmedAt,
              downloadToken,
              revoked,
            },
          });
        },
      );

      /**
       * GET /api/driver/session-key
       * Re-issue the session encryption key (e.g. after tab close/browser kill).
       * Only works while the dispatch session is active and key hasn't expired in Redis.
       */
      scoped.get(
        '/api/driver/session-key',
        { preHandler: [fastify.requireDriver] },
        async (request: FastifyRequest, reply: FastifyReply) => {
          const driverId = request.user.sub;

          const session = await dispatchService.getActiveSession();
          if (!session) {
            return reply.code(404).send({
              success: false,
              error: 'No active dispatch session',
            });
          }

          // Check if revoked
          const revoked = await dispatchService.isSessionRevoked(driverId, session.id);
          if (revoked) {
            return reply.code(403).send({
              success: false,
              error: 'Session has been revoked',
            });
          }

          const sessionKey = await dispatchService.getSessionKey(driverId, session.id);
          if (!sessionKey) {
            return reply.code(404).send({
              success: false,
              error: 'No session key found (expired or not yet downloaded)',
            });
          }

          return reply.send({
            success: true,
            data: { sessionKey },
          });
        },
      );

      /**
       * POST /api/driver/download
       * Download route with a one-time token.
       */
      scoped.post(
        '/api/driver/download',
        { preHandler: [fastify.requireDriver] },
        async (request: FastifyRequest, reply: FastifyReply) => {
          const parsed = downloadRouteSchema.safeParse(request.body);
          if (!parsed.success) {
            return reply.code(400).send({
              success: false,
              error: 'Invalid request body',
              details: parsed.error.issues,
            });
          }

          const routePacket = await dispatchService.downloadRoute(
            parsed.data.token,
          );

          if (!routePacket) {
            return reply.code(403).send({
              success: false,
              error: 'Invalid, expired, or already-used download token',
            });
          }

          // Verify that the token belongs to this driver
          if (routePacket.driverId !== request.user.sub) {
            return reply.code(403).send({
              success: false,
              error: 'Token does not belong to this driver',
            });
          }

          // Reorder stops: nearest to driver first, then nearest-neighbour chain
          const driverLat = parsed.data.driverLat;
          const driverLng = parsed.data.driverLng;

          if (driverLat !== undefined && driverLng !== undefined && routePacket.stops.length > 1) {
            // Find nearest stop to driver
            let nearestIdx = 0;
            let nearestDist = Infinity;
            for (let i = 0; i < routePacket.stops.length; i++) {
              const s = routePacket.stops[i];
              const dist = Math.sqrt(
                Math.pow(s.lat - driverLat, 2) + Math.pow(s.lng - driverLng, 2),
              );
              if (dist < nearestDist) {
                nearestDist = dist;
                nearestIdx = i;
              }
            }
            // Move nearest to front, then nearest-neighbour for the rest
            const reordered = [routePacket.stops[nearestIdx]];
            const remaining = routePacket.stops.filter((_, i) => i !== nearestIdx);
            while (remaining.length > 0) {
              const last = reordered[reordered.length - 1];
              let bestIdx = 0;
              let bestDist = Infinity;
              for (let i = 0; i < remaining.length; i++) {
                const d = Math.sqrt(
                  Math.pow(remaining[i].lat - last.lat, 2) +
                  Math.pow(remaining[i].lng - last.lng, 2),
                );
                if (d < bestDist) { bestDist = d; bestIdx = i; }
              }
              reordered.push(remaining.splice(bestIdx, 1)[0]);
            }
            // Reassign sequence numbers
            reordered.forEach((s, i) => { s.sequence = i + 1; });
            routePacket.stops = reordered;
          }

          // Build OSRM waypoints: driver position → stop 1 → stop 2 → ...
          const waypoints: Array<{ lat: number; lng: number }> = [];
          if (driverLat !== undefined && driverLng !== undefined) {
            waypoints.push({ lat: driverLat, lng: driverLng });
          }
          for (const s of routePacket.stops) {
            waypoints.push({ lat: s.lat, lng: s.lng });
          }

          const osrmRoute = await routingService.getRoute(waypoints);

          if (osrmRoute) {
            routePacket.routeGeometry = osrmRoute.geometry;
            routePacket.routeDistance = osrmRoute.distance;
            routePacket.routeDuration = osrmRoute.duration;
          }

          const tileBounds = routingService.getTileBounds(waypoints);
          routePacket.tileBounds = tileBounds;
          routePacket.tileUrls = routingService.getTileUrls(tileBounds);

          return reply.send({
            success: true,
            data: routePacket,
          });
        },
      );

      /**
       * POST /api/driver/sync
       * Sync delivery status updates from the driver app (offline-first support).
       */
      scoped.post(
        '/api/driver/sync',
        { preHandler: [fastify.requireDriver] },
        async (request: FastifyRequest, reply: FastifyReply) => {
          const parsed = syncSchema.safeParse(request.body);
          if (!parsed.success) {
            return reply.code(400).send({
              success: false,
              error: 'Invalid request body',
              details: parsed.error.issues,
            });
          }

          const payload: DriverSyncPayload = {
            driverId: request.user.sub,
            updates: parsed.data.updates,
          };

          const results = await dispatchService.syncDriverUpdates(payload);

          // Fire-and-forget notifications for status transitions
          for (const update of parsed.data.updates) {
            if (update.status === 'in_transit' || update.status === 'delivered') {
              const messageKey =
                update.status === 'in_transit'
                  ? 'notification.delivery.enRoute'
                  : 'notification.delivery.delivered';

              // Async: do not await -- avoid slowing down sync response
              (async () => {
                try {
                  // Look up delivery to get recipientId
                  const [delivery] = await db
                    .select({ recipientId: deliveries.recipientId })
                    .from(deliveries)
                    .where(eq(deliveries.id, update.deliveryId));

                  if (!delivery?.recipientId) return;

                  // Look up recipient with decrypted phone
                  const [recipient] = await db
                    .select({
                      phone: sql<string>`pgp_sym_decrypt(${recipients.phoneEnc}::bytea, ${config.DEK})`,
                      communicationPreference: recipients.communicationPreference,
                      language: recipients.language,
                      whatsappConsent: recipients.whatsappConsent,
                    })
                    .from(recipients)
                    .where(eq(recipients.id, delivery.recipientId));

                  if (!recipient?.phone) return;

                  const contact: RecipientContact = {
                    phone: recipient.phone,
                    communicationPreference:
                      (recipient.communicationPreference as RecipientContact['communicationPreference']) ?? 'sms',
                    language: recipient.language ?? undefined,
                    whatsappConsent: recipient.whatsappConsent ?? false,
                  };

                  await notificationService.send(contact, messageKey);
                } catch (err) {
                  fastify.log.error(
                    { err, deliveryId: update.deliveryId, status: update.status },
                    'Failed to send delivery notification',
                  );
                }
              })();
            }
          }

          return reply.send({
            success: true,
            data: { synced: results.length },
          });
        },
      );

      /**
       * POST /api/driver/purge-confirm
       * Confirm that local route data has been purged from the device.
       */
      scoped.post(
        '/api/driver/purge-confirm',
        { preHandler: [fastify.requireDriver] },
        async (request: FastifyRequest, reply: FastifyReply) => {
          const parsed = purgeConfirmSchema.safeParse(request.body);
          if (!parsed.success) {
            return reply.code(400).send({
              success: false,
              error: 'Invalid request body',
              details: parsed.error.issues,
            });
          }

          const result = await dispatchService.confirmPurge(
            request.user.sub,
            parsed.data.sessionId,
          );

          if (!result) {
            return reply.code(404).send({
              success: false,
              error: 'No check-in found for this session',
            });
          }

          return reply.send({
            success: true,
            data: result,
          });
        },
      );
    },
  );
}
