import { FastifyInstance } from 'fastify';
import { rideService } from '../services/ride.service.js';

export default async function rideRoutes(fastify: FastifyInstance) {
  // ========== Shifts ==========

  /** List shifts for a date range */
  fastify.get('/api/rides/shifts', {
    preHandler: [fastify.requireAdmin],
  }, async (request, reply) => {
    const { from, to, status, driverId, recipientId } = request.query as {
      from?: string; to?: string; status?: string; driverId?: string; recipientId?: string;
    };

    const today = new Date().toISOString().split('T')[0];
    const shifts = await rideService.listShifts({
      from: from ?? today,
      to: to ?? today,
      status,
      driverId,
      recipientId,
    });

    return { success: true, data: shifts };
  });

  /** Get a single shift */
  fastify.get<{ Params: { id: string } }>('/api/rides/shifts/:id', {
    preHandler: [fastify.requireAdmin],
  }, async (request, reply) => {
    const shift = await rideService.getShift(request.params.id);
    if (!shift) return reply.code(404).send({ success: false, error: 'Shift not found' });
    return { success: true, data: shift };
  });

  /** Create an ad-hoc shift */
  fastify.post('/api/rides/shifts', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const shift = await rideService.createAdHocShift(request.body as any);
    return { success: true, data: shift };
  });

  /** Driver claims a shift */
  fastify.post<{ Params: { id: string } }>('/api/rides/shifts/:id/claim', {
    preHandler: [fastify.requireDriver],
  }, async (request, reply) => {
    const result = await rideService.claimShift(request.params.id, request.user.sub);
    if ('error' in result) {
      return reply.code(409).send({ success: false, error: result.error });
    }
    return { success: true, data: result };
  });

  /** Coordinator confirms a claim */
  fastify.post<{ Params: { id: string } }>('/api/rides/shifts/:id/confirm', {
    preHandler: [fastify.requireAdmin],
  }, async (request, reply) => {
    const shift = await rideService.confirmShift(request.params.id);
    if (!shift) return reply.code(404).send({ success: false, error: 'Shift not found or not claimed' });
    return { success: true, data: shift };
  });

  /** Coordinator rejects a claim */
  fastify.post<{ Params: { id: string } }>('/api/rides/shifts/:id/reject', {
    preHandler: [fastify.requireAdmin],
  }, async (request, reply) => {
    const shift = await rideService.rejectClaim(request.params.id);
    if (!shift) return reply.code(404).send({ success: false, error: 'Shift not found or not claimed' });
    return { success: true, data: shift };
  });

  /** Driver starts a ride */
  fastify.post<{ Params: { id: string } }>('/api/rides/shifts/:id/start', {
    preHandler: [fastify.requireDriver],
  }, async (request, reply) => {
    const shift = await rideService.startShift(request.params.id);
    if (!shift) return reply.code(404).send({ success: false, error: 'Shift not found or not confirmed' });
    return { success: true, data: shift };
  });

  /** Driver completes a ride */
  fastify.post<{ Params: { id: string } }>('/api/rides/shifts/:id/complete', {
    preHandler: [fastify.requireDriver],
  }, async (request, reply) => {
    const shift = await rideService.completeShift(request.params.id);
    if (!shift) return reply.code(404).send({ success: false, error: 'Shift not found or not in progress' });
    return { success: true, data: shift };
  });

  /** Cancel a shift */
  fastify.post<{ Params: { id: string } }>('/api/rides/shifts/:id/cancel', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { reason } = request.body as { reason?: string };
    const shift = await rideService.cancelShift(request.params.id, reason ?? 'Cancelled by coordinator');
    return { success: true, data: shift };
  });

  /** Mark no-show */
  fastify.post<{ Params: { id: string } }>('/api/rides/shifts/:id/no-show', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const shift = await rideService.markNoShow(request.params.id);
    return { success: true, data: shift };
  });

  // ========== Shift board (driver view) ==========

  fastify.get('/api/rides/shift-board', {
    preHandler: [fastify.requireDriver],
  }, async (request) => {
    const board = await rideService.getShiftBoard(request.user.sub);
    return { success: true, data: board };
  });

  // ========== Schedules ==========

  fastify.get('/api/rides/schedules', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { recipientId } = request.query as { recipientId?: string };
    const schedules = await rideService.listSchedules(recipientId);
    return { success: true, data: schedules };
  });

  fastify.post('/api/rides/schedules', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const data = request.body as any;
    data.createdBy = request.user.sub;
    const schedule = await rideService.createSchedule(data);
    return { success: true, data: schedule };
  });

  fastify.patch<{ Params: { id: string } }>('/api/rides/schedules/:id', {
    preHandler: [fastify.requireAdmin],
  }, async (request, reply) => {
    const schedule = await rideService.updateSchedule(request.params.id, request.body as any);
    if (!schedule) return reply.code(404).send({ success: false, error: 'Schedule not found' });
    return { success: true, data: schedule };
  });

  /** Generate shifts from a schedule for a given week */
  fastify.post<{ Params: { id: string } }>('/api/rides/schedules/:id/generate', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { weekStartDate } = request.body as { weekStartDate: string };
    const shifts = await rideService.generateShiftsFromSchedule(request.params.id, weekStartDate);
    return { success: true, data: shifts };
  });

  // ========== Saved locations ==========

  fastify.get<{ Params: { recipientId: string } }>('/api/rides/passengers/:recipientId/locations', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const locations = await rideService.listLocations(request.params.recipientId);
    return { success: true, data: locations };
  });

  fastify.post<{ Params: { recipientId: string } }>('/api/rides/passengers/:recipientId/locations', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const data = request.body as any;
    data.recipientId = request.params.recipientId;
    const location = await rideService.createLocation(data);
    return { success: true, data: location };
  });

  // ========== Affinity ==========

  fastify.get<{ Params: { recipientId: string } }>('/api/rides/passengers/:recipientId/affinities', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const affinities = await rideService.getAffinities(request.params.recipientId);
    return { success: true, data: affinities };
  });

  fastify.post('/api/rides/affinities/preferred', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { driverId, recipientId, preferred } = request.body as {
      driverId: string; recipientId: string; preferred: boolean;
    };
    await rideService.setPreferredPairing(driverId, recipientId, preferred);
    return { success: true };
  });

  // ========== Intake ==========

  fastify.get('/api/rides/intake', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { status } = request.query as { status?: string };
    const requests = await rideService.listIntakeRequests(status);
    return { success: true, data: requests };
  });

  fastify.post('/api/rides/intake', async (request) => {
    // Public endpoint — intake can come from webhooks
    const intake = await rideService.createIntakeRequest(request.body as any);
    return { success: true, data: intake };
  });

  fastify.post<{ Params: { id: string } }>('/api/rides/intake/:id/process', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const result = await rideService.processIntakeRequest(
      request.params.id,
      request.user.sub,
      request.body as any,
    );
    return { success: true, data: result };
  });

  // ========== Dashboard stats ==========

  fastify.get('/api/rides/stats', {
    preHandler: [fastify.requireAdmin],
  }, async () => {
    const stats = await rideService.getRideStats();
    return { success: true, data: stats };
  });
}
