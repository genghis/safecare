import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, ne, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deliveries, dispatchSessions, recipients } from '../db/schema.js';
import { config } from '../config.js';
import { distributionService } from '../services/distribution.service.js';
import { dispatchService } from '../services/dispatch.service.js';
import { driverService } from '../services/driver.service.js';

const proposeSchema = z.object({
  sessionId: z.string().uuid(),
  dayOfWeek: z.string().min(1),
});

const moveSchema = z.object({
  sessionId: z.string().uuid(),
  deliveryId: z.string().uuid(),
  fromDriverId: z.string().uuid(),
  toDriverId: z.string().uuid(),
});

const adjustCapacitySchema = z.object({
  sessionId: z.string().uuid(),
  driverId: z.string().uuid(),
  maxDeliveries: z.number().int().positive(),
});

const removeDriverSchema = z.object({
  sessionId: z.string().uuid(),
  driverId: z.string().uuid(),
});

const confirmSchema = z.object({
  sessionId: z.string().uuid(),
  assignments: z.array(
    z.object({
      driverId: z.string().uuid(),
      deliveryIds: z.array(z.string().uuid()),
    }),
  ),
});

export default async function distributionRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/distribution
   * Returns distribution state for the dashboard.
   * Query params: sessionId (optional), day (optional).
   */
  fastify.get(
    '/api/distribution',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, day } = request.query as {
        sessionId?: string;
        day?: string;
      };

      // Determine which session to use
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const sessions = await db
          .select()
          .from(dispatchSessions)
          .where(ne(dispatchSessions.status, 'completed'))
          .orderBy(desc(dispatchSessions.createdAt))
          .limit(1);
        activeSessionId = sessions[0]?.id;
      }

      // Fetch all available sessions for the dropdown
      const allSessions = await db
        .select()
        .from(dispatchSessions)
        .orderBy(desc(dispatchSessions.createdAt));

      if (!activeSessionId) {
        return reply.send({
          success: true,
          data: {
            drivers: [],
            unassigned: [],
            warnings: ['No dispatch session found.'],
            sessions: allSessions,
          },
        });
      }

      // Fetch vetted drivers (optionally filtered by day availability)
      const allDrivers = await driverService.list();
      const vettedDrivers = allDrivers.filter(
        (d) => d.vettedStatus === 'vetted',
      );

      // Build driver assignment map from existing deliveries in this session
      const sessionDeliveries = await db
        .select({
          id: deliveries.id,
          recipientId: deliveries.recipientId,
          driverId: deliveries.driverId,
          status: deliveries.status,
          address: sql<string>`pgp_sym_decrypt(${deliveries.addressEnc}::bytea, ${config.DEK})`,
          lat: deliveries.lat,
          lng: deliveries.lng,
          notes: deliveries.notes,
          recipientName: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
        })
        .from(deliveries)
        .leftJoin(recipients, eq(deliveries.recipientId, recipients.id))
        .where(eq(deliveries.dispatchSessionId, activeSessionId));

      // Group deliveries by driver
      const driverDeliveryMap = new Map<
        string,
        Array<{
          deliveryId: string;
          recipientName: string;
          address: string;
          lat: number;
          lng: number;
          notes: string;
          status: string | null;
        }>
      >();

      const unassigned: Array<{
        deliveryId: string;
        recipientName: string;
        address: string;
        lat: number;
        lng: number;
        reason: string;
      }> = [];

      for (const d of sessionDeliveries) {
        const entry = {
          deliveryId: d.id,
          recipientName: d.recipientName ?? '',
          address: d.address ?? '',
          lat: parseFloat(d.lat ?? '0'),
          lng: parseFloat(d.lng ?? '0'),
          notes: d.notes ?? '',
          status: d.status,
        };

        if (d.driverId) {
          const existing = driverDeliveryMap.get(d.driverId) ?? [];
          existing.push(entry);
          driverDeliveryMap.set(d.driverId, existing);
        } else {
          unassigned.push({
            deliveryId: d.id,
            recipientName: d.recipientName ?? '',
            address: d.address ?? '',
            lat: parseFloat(d.lat ?? '0'),
            lng: parseFloat(d.lng ?? '0'),
            reason: 'Not yet assigned to a driver',
          });
        }
      }

      // Build driver response objects
      const driverResults = vettedDrivers.map((driver) => ({
        driverId: driver.id,
        driverName: driver.name,
        vehicleSize: driver.vehicleSize ?? 'sedan',
        maxDeliveries: driver.maxDeliveries ?? 3,
        deliveries: driverDeliveryMap.get(driver.id) ?? [],
        loadPercent: Math.round(
          ((driverDeliveryMap.get(driver.id)?.length ?? 0) /
            (driver.maxDeliveries ?? 3)) *
            100,
        ),
      }));

      const warnings: string[] = [];
      if (unassigned.length > 0) {
        warnings.push(
          `${unassigned.length} delivery(ies) not yet assigned.`,
        );
      }
      for (const dr of driverResults) {
        if (dr.loadPercent > 100) {
          warnings.push(
            `Driver ${dr.driverName} exceeds capacity (${dr.deliveries.length}/${dr.maxDeliveries}).`,
          );
        }
      }

      return reply.send({
        success: true,
        data: {
          drivers: driverResults,
          unassigned,
          warnings,
          sessions: allSessions,
        },
      });
    },
  );

  /**
   * POST /api/distribution/propose
   * Generate a distribution proposal (admin only).
   */
  fastify.post(
    '/api/distribution/propose',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = proposeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const proposal = await distributionService.generateProposal(
        parsed.data.sessionId,
        parsed.data.dayOfWeek as any,
      );

      // Persist assignments to the database immediately
      for (const assignment of proposal.assignments) {
        for (const delivery of assignment.deliveries) {
          await db
            .update(deliveries)
            .set({
              driverId: assignment.driverId,
              status: 'assigned',
            })
            .where(eq(deliveries.id, delivery.deliveryId));
        }
      }

      return reply.send({ success: true, data: proposal });
    },
  );

  /**
   * POST /api/distribution/move
   * Move a delivery between drivers (admin only).
   */
  fastify.post(
    '/api/distribution/move',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = moveSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const proposal = await distributionService.moveDelivery(
        parsed.data.sessionId,
        parsed.data.deliveryId,
        parsed.data.fromDriverId,
        parsed.data.toDriverId,
      );

      return reply.send({ success: true, data: proposal });
    },
  );

  /**
   * POST /api/distribution/adjust-capacity
   * Change a driver's capacity for this session (admin only).
   */
  fastify.post(
    '/api/distribution/adjust-capacity',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adjustCapacitySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const proposal = await distributionService.adjustDriverCapacity(
        parsed.data.sessionId,
        parsed.data.driverId,
        parsed.data.maxDeliveries,
      );

      return reply.send({ success: true, data: proposal });
    },
  );

  /**
   * POST /api/distribution/remove-driver
   * Remove a driver and redistribute deliveries (admin only).
   */
  fastify.post(
    '/api/distribution/remove-driver',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = removeDriverSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const proposal = await distributionService.removeDriver(
        parsed.data.sessionId,
        parsed.data.driverId,
      );

      return reply.send({ success: true, data: proposal });
    },
  );

  /**
   * POST /api/distribution/confirm
   * Confirm the proposal and create actual delivery assignments (admin only).
   */
  fastify.post(
    '/api/distribution/confirm',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = confirmSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { sessionId, assignments } = parsed.data;

      // Convert grouped assignments into flat assignment list for dispatchService
      const flatAssignments = assignments.flatMap((a) =>
        a.deliveryIds.map((deliveryId) => ({
          deliveryId,
          driverId: a.driverId,
        })),
      );

      const results = await dispatchService.assignDeliveries(
        sessionId,
        flatAssignments,
      );

      return reply.send({
        success: true,
        data: { confirmed: true, assigned: results.length },
      });
    },
  );
}
