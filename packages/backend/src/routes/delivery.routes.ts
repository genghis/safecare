import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deliveries, recipients } from '../db/schema.js';
import { config } from '../config.js';

const createDeliverySchema = z.object({
  recipientId: z.string().uuid(),
  dispatchSessionId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

const statusFilterSchema = z.object({
  status: z
    .enum([
      'pending',
      'assigned',
      'released',
      'in_transit',
      'delivered',
      'acknowledged',
      'failed',
    ])
    .optional(),
});

export default async function deliveryRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/deliveries
   * List deliveries with optional status filter (admin only).
   */
  fastify.get(
    '/api/deliveries',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = statusFilterSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid query parameters',
          details: parsed.error.issues,
        });
      }

      const conditions = [];
      if (parsed.data.status) {
        conditions.push(eq(deliveries.status, parsed.data.status));
      }

      const rows = await db
        .select({
          id: deliveries.id,
          recipientId: deliveries.recipientId,
          driverId: deliveries.driverId,
          dispatchSessionId: deliveries.dispatchSessionId,
          status: deliveries.status,
          address: sql<string>`pgp_sym_decrypt(${deliveries.addressEnc}::bytea, ${config.DEK})`,
          lat: deliveries.lat,
          lng: deliveries.lng,
          notes: deliveries.notes,
          releasedAt: deliveries.releasedAt,
          deliveredAt: deliveries.deliveredAt,
          acknowledgedAt: deliveries.acknowledgedAt,
          createdAt: deliveries.createdAt,
        })
        .from(deliveries)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return reply.send({ success: true, data: rows });
    },
  );

  /**
   * POST /api/deliveries
   * Create a new delivery (admin only).
   * Copies the recipient's encrypted address and coordinates to the delivery record.
   */
  fastify.post(
    '/api/deliveries',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createDeliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      // Look up recipient to snapshot address data
      const recipientRows = await db
        .select({
          id: recipients.id,
          addressEnc: recipients.addressEnc,
          lat: recipients.lat,
          lng: recipients.lng,
        })
        .from(recipients)
        .where(eq(recipients.id, parsed.data.recipientId));

      const recipient = recipientRows[0];
      if (!recipient) {
        return reply.code(404).send({
          success: false,
          error: 'Recipient not found',
        });
      }

      const result = await db
        .insert(deliveries)
        .values({
          recipientId: parsed.data.recipientId,
          dispatchSessionId: parsed.data.dispatchSessionId,
          driverId: parsed.data.driverId,
          addressEnc: recipient.addressEnc,
          lat: recipient.lat,
          lng: recipient.lng,
          notes: parsed.data.notes,
          status: 'pending',
        })
        .returning({ id: deliveries.id });

      return reply.code(201).send({
        success: true,
        data: { id: result[0].id },
      });
    },
  );

  /**
   * PATCH /api/deliveries/:id/acknowledge
   * Mark a delivery as acknowledged (by recipient).
   * No auth required - typically triggered via SMS/webhook callback.
   */
  fastify.patch(
    '/api/deliveries/:id/acknowledge',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const result = await db
        .update(deliveries)
        .set({
          status: 'acknowledged',
          acknowledgedAt: new Date(),
        })
        .where(
          and(
            eq(deliveries.id, id),
            eq(deliveries.status, 'delivered'),
          ),
        )
        .returning({ id: deliveries.id });

      if (result.length === 0) {
        return reply.code(404).send({
          success: false,
          error: 'Delivery not found or not in delivered status',
        });
      }

      return reply.send({
        success: true,
        data: { id: result[0].id, acknowledgedAt: new Date() },
      });
    },
  );
}
