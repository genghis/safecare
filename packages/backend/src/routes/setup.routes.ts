import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service.js';
import { provisionService } from '../services/provision.service.js';
import Redis from 'ioredis';
import { config } from '../config.js';

const redis = new Redis(config.REDIS_URL);

export default async function setupRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/setup/status
   * Returns whether initial setup is needed. No auth required.
   * This is the ONLY unauthenticated endpoint besides login/register.
   */
  fastify.get(
    '/api/setup/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const adminExists = await authService.adminExists();
      const settingsRaw = await redis.get('org:settings');
      const settings = settingsRaw ? JSON.parse(settingsRaw) : null;
      const hasOperatingRegion = !!settings?.serviceArea?.bounds;

      let provisionStatus = 'not_started';
      try {
        const provRaw = await redis.get('map:provision:status');
        if (provRaw) {
          const prov = JSON.parse(provRaw);
          provisionStatus = prov.status || 'not_started';
        }
      } catch { /* ignore */ }

      // Check if Nominatim is actually serving
      if (provisionStatus === 'ready' || provisionStatus === 'importing') {
        try {
          const res = await fetch(`${config.GEOCODING_URL}/status`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) provisionStatus = 'ready';
          else provisionStatus = 'importing';
        } catch {
          if (provisionStatus === 'ready') provisionStatus = 'importing';
        }
      }

      // Check cloud provisioning availability (non-blocking, cached briefly)
      let cloudAvailable = false;
      try {
        cloudAvailable = await provisionService.isCloudAvailable();
      } catch { /* ignore */ }

      const setupComplete = adminExists && hasOperatingRegion && provisionStatus === 'ready';

      // Read import progress if importing
      let importMessage = '';
      if (provisionStatus === 'importing') {
        try {
          const { readFile } = await import('fs/promises');
          const line = (await readFile('/app/map-data/import-progress.txt', 'utf-8')).trim();
          if (line && line !== 'waiting' && line !== 'starting') {
            importMessage = line.length > 120 ? line.substring(0, 120) + '...' : line;
          }
        } catch { /* no progress file yet */ }
      }

      return reply.send({
        success: true,
        data: {
          setupComplete,
          steps: {
            adminCreated: adminExists,
            operatingRegionSet: hasOperatingRegion,
            mapsProvisioned: provisionStatus === 'ready',
            mapsStatus: provisionStatus,
            importMessage: importMessage || undefined,
            cloudAvailable,
          },
        },
      });
    },
  );
}
