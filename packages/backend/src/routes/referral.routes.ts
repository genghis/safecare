import { FastifyInstance } from 'fastify';
import { referralService } from '../services/referral.service.js';

export default async function referralRoutes(fastify: FastifyInstance) {
  // ========== Provider CRUD ==========

  /** List all providers (admin directory view) */
  fastify.get('/api/referrals/providers', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { category, status } = request.query as { category?: string; status?: string };
    const providers = await referralService.listProviders({ category, status });
    return { success: true, data: providers };
  });

  /** Search the referral directory — the Signal-chat replacement */
  fastify.get('/api/referrals/search', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { query, category, neighborhood, lowBono, languages } = request.query as {
      query?: string;
      category?: string;
      neighborhood?: string;
      lowBono?: string;
      languages?: string;
    };

    const results = await referralService.search(request.user.sub, {
      query,
      category,
      neighborhood,
      lowBono: lowBono === 'true',
      languages: languages ? languages.split(',') : undefined,
    });

    return { success: true, data: results };
  });

  /** Get a single provider with full details */
  fastify.get<{ Params: { id: string } }>('/api/referrals/providers/:id', {
    preHandler: [fastify.requireAdmin],
  }, async (request, reply) => {
    const provider = await referralService.getProvider(request.params.id);
    if (!provider) return reply.code(404).send({ success: false, error: 'Provider not found' });
    return { success: true, data: provider };
  });

  /** Create a new provider */
  fastify.post('/api/referrals/providers', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const provider = await referralService.createProvider(
      request.user.sub,
      request.body as any,
    );
    return { success: true, data: provider };
  });

  /** Update a provider */
  fastify.patch<{ Params: { id: string } }>('/api/referrals/providers/:id', {
    preHandler: [fastify.requireAdmin],
  }, async (request, reply) => {
    const result = await referralService.updateProvider(request.params.id, request.body as any);
    if (!result) return reply.code(404).send({ success: false, error: 'Provider not found' });
    return { success: true, data: result };
  });

  // ========== Vouches ==========

  /** Add or update a vouch for a provider */
  fastify.post<{ Params: { id: string } }>('/api/referrals/providers/:id/vouch', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const { level, notes } = request.body as { level?: string; notes?: string };
    const vouch = await referralService.addVouch(
      request.params.id,
      request.user.sub,
      level,
      notes,
    );
    return { success: true, data: vouch };
  });

  /** Remove your vouch from a provider */
  fastify.delete<{ Params: { id: string } }>('/api/referrals/providers/:id/vouch', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    await referralService.removeVouch(request.params.id, request.user.sub);
    return { success: true };
  });

  /** Get vouches for a provider */
  fastify.get<{ Params: { id: string } }>('/api/referrals/providers/:id/vouches', {
    preHandler: [fastify.requireAdmin],
  }, async (request) => {
    const vouches = await referralService.getVouches(request.params.id);
    return { success: true, data: vouches };
  });

  // ========== Stats ==========

  fastify.get('/api/referrals/stats', {
    preHandler: [fastify.requireAdmin],
  }, async () => {
    const stats = await referralService.getStats();
    return { success: true, data: stats };
  });
}
