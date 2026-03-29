import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import Redis from 'ioredis';
import { config } from '../config.js';

const redis = new Redis(config.REDIS_URL);

const SETTINGS_KEY = 'org:settings';

const serviceAreaSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  zoom: z.number().min(1).max(20),
  label: z.string(),
});

const settingsSchema = z.object({
  orgName: z.string().min(1),
  serviceArea: serviceAreaSchema,
});

export default async function settingsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/settings
   * Return the current org settings (admin only).
   */
  fastify.get(
    '/api/settings',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const raw = await redis.get(SETTINGS_KEY);

      if (!raw) {
        return reply.send({
          success: true,
          data: null,
        });
      }

      return reply.send({
        success: true,
        data: JSON.parse(raw),
      });
    },
  );

  /**
   * PUT /api/settings
   * Save org settings to Redis (admin only).
   */
  fastify.put(
    '/api/settings',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      await redis.set(SETTINGS_KEY, JSON.stringify(parsed.data));

      return reply.send({
        success: true,
        data: parsed.data,
      });
    },
  );
}
