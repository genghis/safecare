import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { distributionService } from '../services/distribution.service.js';
import { dispatchService } from '../services/dispatch.service.js';

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

      const proposal = await distributionService.propose(
        parsed.data.sessionId,
        parsed.data.dayOfWeek,
      );

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

      const proposal = await distributionService.adjustCapacity(
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
