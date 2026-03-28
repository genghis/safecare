import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { geocodeService } from '../services/geocode.service.js';

const searchSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(10).optional(),
});

const reverseSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export default async function geocodeRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/geocode/search
   * Forward geocoding proxy. Admin-only.
   * Uses POST to keep address queries out of URL/access logs.
   */
  fastify.post(
    '/api/geocode/search',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = searchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      try {
        const results = await geocodeService.search(
          parsed.data.query,
          parsed.data.limit,
        );
        return reply.send({ success: true, data: results });
      } catch (err) {
        fastify.log.error(err, 'Geocoding search failed');
        return reply.code(502).send({
          success: false,
          error: 'Geocoding service unavailable',
        });
      }
    },
  );

  /**
   * POST /api/geocode/reverse
   * Reverse geocoding proxy. Admin-only.
   * Uses POST to keep coordinates out of URL/access logs.
   */
  fastify.post(
    '/api/geocode/reverse',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reverseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      try {
        const result = await geocodeService.reverse(
          parsed.data.lat,
          parsed.data.lng,
        );
        return reply.send({ success: true, data: result });
      } catch (err) {
        fastify.log.error(err, 'Reverse geocoding failed');
        return reply.code(502).send({
          success: false,
          error: 'Geocoding service unavailable',
        });
      }
    },
  );
}
