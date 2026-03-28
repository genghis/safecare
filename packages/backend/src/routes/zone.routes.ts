import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zoneService } from '../services/zone.service.js';

const pointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const createZoneSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color').optional(),
  polygon: z.array(pointSchema).min(3, 'Polygon must have at least 3 points'),
});

const updateZoneSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color').optional(),
  polygon: z.array(pointSchema).min(3, 'Polygon must have at least 3 points').optional(),
});

export default async function zoneRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/zones
   * List all active zones (admin only).
   */
  fastify.get(
    '/api/zones',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const zones = await zoneService.list();
      return reply.send({ success: true, data: zones });
    },
  );

  /**
   * GET /api/zones/:id
   * Get a single zone by id (admin only).
   */
  fastify.get(
    '/api/zones/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const zone = await zoneService.findById(id);

      if (!zone) {
        return reply.code(404).send({
          success: false,
          error: 'Zone not found',
        });
      }

      return reply.send({ success: true, data: zone });
    },
  );

  /**
   * POST /api/zones
   * Create a new zone (admin only).
   */
  fastify.post(
    '/api/zones',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createZoneSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const zone = await zoneService.create(parsed.data);

      return reply.code(201).send({
        success: true,
        data: zone,
      });
    },
  );

  /**
   * PUT /api/zones/:id
   * Update a zone (admin only).
   */
  fastify.put(
    '/api/zones/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = updateZoneSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const zone = await zoneService.update(id, parsed.data);

      if (!zone) {
        return reply.code(404).send({
          success: false,
          error: 'Zone not found',
        });
      }

      return reply.send({ success: true, data: zone });
    },
  );

  /**
   * DELETE /api/zones/:id
   * Deactivate a zone (admin only).
   */
  fastify.delete(
    '/api/zones/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await zoneService.deactivate(id);

      if (!result) {
        return reply.code(404).send({
          success: false,
          error: 'Zone not found',
        });
      }

      return reply.send({ success: true, data: { deactivated: true } });
    },
  );
}
