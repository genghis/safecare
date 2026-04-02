import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import Redis from 'ioredis';
import { tileService } from '../services/tile.service.js';
import { config } from '../config.js';
import { routingService, type TileBounds } from '../services/routing.service.js';

const tileParamsSchema = z.object({
  z: z.coerce.number().int().min(0).max(19),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});
const redis = new Redis(config.REDIS_URL);
const SETTINGS_KEY = 'org:settings';
const BOUNDS_CACHE_TTL_MS = 30_000;

let cachedBounds: TileBounds | null = null;
let boundsFetchedAt = 0;

export default async function tilesRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/tiles/:z/:x/:y.png',
    {
      config: {
        rateLimit: {
          max: 1500,
          timeWindow: '1 minute',
          groupId: 'tile-cache',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = tileParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid tile coordinates',
        });
      }

      try {
        const operatingBounds = await getOperatingBounds();
        if (
          operatingBounds &&
          !routingService.boundsIncludeTile(
            operatingBounds,
            parsed.data.z,
            parsed.data.x,
            parsed.data.y,
          )
        ) {
          return reply.code(404).send({
            success: false,
            error: 'Tile not available',
          });
        }

        const tile = await tileService.getTile(
          parsed.data.z,
          parsed.data.x,
          parsed.data.y,
        );

        if (!tile) {
          return reply.code(404).send({
            success: false,
            error: 'Tile not available',
          });
        }

        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return reply.type('image/png').send(tile);
      } catch (err) {
        fastify.log.error(err, 'Tile lookup failed');
        return reply.code(502).send({
          success: false,
          error: 'Tile service unavailable',
        });
      }
    },
  );
}

async function getOperatingBounds(): Promise<TileBounds | null> {
  if (Date.now() - boundsFetchedAt < BOUNDS_CACHE_TTL_MS) {
    return cachedBounds;
  }

  boundsFetchedAt = Date.now();

  try {
    const raw = await redis.get(SETTINGS_KEY);
    if (!raw) {
      cachedBounds = null;
      return null;
    }

    const settings = JSON.parse(raw);
    cachedBounds = settings?.serviceArea?.bounds ?? null;
    return cachedBounds;
  } catch {
    cachedBounds = null;
    return null;
  }
}
