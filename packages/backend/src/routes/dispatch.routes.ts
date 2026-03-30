import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dispatchService } from '../services/dispatch.service.js';
import { eq, ne, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { driverCheckIns, dispatchSessions, deliveries, drivers, recipients } from '../db/schema.js';
import { config } from '../config.js';

const createSessionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strictnessLevel: z.enum(['standard', 'high', 'maximum']).optional(),
  downloadTokenTtlMinutes: z.number().int().positive().optional(),
  routeDataTtlHours: z.number().int().positive().optional(),
});

const assignDeliveriesSchema = z.object({
  assignments: z.array(
    z.object({
      deliveryId: z.string().uuid(),
      driverId: z.string().uuid(),
    }),
  ),
});

const releaseRoutesSchema = z.object({
  driverIds: z.array(z.string().uuid()),
});

export default async function dispatchRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/dispatch/sessions
   * Create a new dispatch session (admin only).
   */
  fastify.post(
    '/api/dispatch/sessions',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const session = await dispatchService.createSession({
        ...parsed.data,
        createdBy: request.user.sub,
      });

      return reply.code(201).send({
        success: true,
        data: session,
      });
    },
  );

  /**
   * GET /api/dispatch/sessions/active
   * Get the latest non-completed dispatch session with check-ins and deliveries.
   */
  fastify.get(
    '/api/dispatch/sessions/active',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Find the latest session that is not 'completed'
      const sessions = await db
        .select()
        .from(dispatchSessions)
        .where(ne(dispatchSessions.status, 'completed'))
        .orderBy(desc(dispatchSessions.createdAt))
        .limit(1);

      const session = sessions[0] ?? null;

      if (!session) {
        return reply.send({
          success: true,
          data: { session: null, checkIns: [], deliveries: [] },
        });
      }

      // Fetch check-ins with driver names
      const checkInRows = await db
        .select({
          id: driverCheckIns.id,
          driverId: driverCheckIns.driverId,
          dispatchSessionId: driverCheckIns.dispatchSessionId,
          checkedInAt: driverCheckIns.checkedInAt,
          routeReleasedAt: driverCheckIns.routeReleasedAt,
          driverName: sql<string>`pgp_sym_decrypt(${drivers.nameEnc}::bytea, ${config.DEK})`,
          vehicle: drivers.vehicleSize,
        })
        .from(driverCheckIns)
        .leftJoin(drivers, eq(driverCheckIns.driverId, drivers.id))
        .where(eq(driverCheckIns.dispatchSessionId, session.id));

      // Fetch deliveries with recipient names
      const sessionDeliveries = await db
        .select({
          id: deliveries.id,
          recipientName: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
          address: sql<string>`pgp_sym_decrypt(${deliveries.addressEnc}::bytea, ${config.DEK})`,
          driverName: sql<string>`COALESCE(pgp_sym_decrypt(${drivers.nameEnc}::bytea, ${config.DEK}), 'Unassigned')`,
          status: deliveries.status,
          driverId: deliveries.driverId,
        })
        .from(deliveries)
        .leftJoin(recipients, eq(deliveries.recipientId, recipients.id))
        .leftJoin(drivers, eq(deliveries.driverId, drivers.id))
        .where(eq(deliveries.dispatchSessionId, session.id));

      return reply.send({
        success: true,
        data: { session, checkIns: checkInRows, deliveries: sessionDeliveries },
      });
    },
  );

  /**
   * GET /api/dispatch/sessions/:id
   * Get a dispatch session by id with check-ins (admin only).
   */
  fastify.get(
    '/api/dispatch/sessions/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const session = await dispatchService.getSession(id);

      if (!session) {
        return reply.code(404).send({
          success: false,
          error: 'Dispatch session not found',
        });
      }

      return reply.send({ success: true, data: session });
    },
  );

  /**
   * POST /api/dispatch/sessions/:id/assign
   * Assign drivers to deliveries within a session (admin only).
   */
  fastify.post(
    '/api/dispatch/sessions/:id/assign',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = assignDeliveriesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const results = await dispatchService.assignDeliveries(
        id,
        parsed.data.assignments,
      );

      return reply.send({
        success: true,
        data: { assigned: results.length },
      });
    },
  );

  /**
   * POST /api/dispatch/sessions/:id/release
   * Release routes to specified drivers (admin only).
   */
  fastify.post(
    '/api/dispatch/sessions/:id/release',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = releaseRoutesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const tokens = await dispatchService.releaseRoutes(
        id,
        parsed.data.driverIds,
      );

      return reply.send({
        success: true,
        data: { released: tokens.length, tokens },
      });
    },
  );

  /**
   * GET /api/dispatch/sessions/:id/check-ins
   * Get check-in status for a dispatch session (admin only).
   */
  fastify.get(
    '/api/dispatch/sessions/:id/check-ins',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const checkIns = await db
        .select()
        .from(driverCheckIns)
        .where(eq(driverCheckIns.dispatchSessionId, id));

      return reply.send({
        success: true,
        data: checkIns,
      });
    },
  );
}
