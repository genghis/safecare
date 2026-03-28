import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { driverService } from '../services/driver.service.js';
import type { VettedStatus } from '@safecare/shared';

const createDriverSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(10).max(15),
  email: z.string().email().optional(),
  vehicleModel: z.string().optional(),
  cargoCapacity: z.number().int().positive().optional(),
  languages: z.array(z.string()).optional(),
  geoPreferences: z.string().optional(),
  timeConstraints: z.string().optional(),
  teamName: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'vetted', 'suspended']),
});

export default async function driverRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/drivers
   * List all drivers (admin only).
   */
  fastify.get(
    '/api/drivers',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const drivers = await driverService.list();
      return reply.send({ success: true, data: drivers });
    },
  );

  /**
   * GET /api/drivers/:id
   * Get a single driver by id (admin only).
   */
  fastify.get(
    '/api/drivers/:id',
    { preHandler: [fastify.requireAdmin] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const driver = await driverService.findById(id);

      if (!driver) {
        return reply.code(404).send({
          success: false,
          error: 'Driver not found',
        });
      }

      return reply.send({ success: true, data: driver });
    },
  );

  /**
   * POST /api/drivers
   * Create a new driver (admin only).
   */
  fastify.post(
    '/api/drivers',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createDriverSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      // Check for duplicate phone
      const existing = await driverService.findByPhone(parsed.data.phone);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: 'A driver with this phone number already exists',
        });
      }

      const id = await driverService.create(parsed.data);

      return reply.code(201).send({
        success: true,
        data: { id },
      });
    },
  );

  /**
   * PATCH /api/drivers/:id/status
   * Update a driver's vetted status (admin only).
   */
  fastify.patch(
    '/api/drivers/:id/status',
    { preHandler: [fastify.requireAdmin] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const parsed = updateStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const result = await driverService.updateVettedStatus(
        id,
        parsed.data.status as VettedStatus,
      );

      if (!result) {
        return reply.code(404).send({
          success: false,
          error: 'Driver not found',
        });
      }

      return reply.send({
        success: true,
        data: result,
      });
    },
  );
}
