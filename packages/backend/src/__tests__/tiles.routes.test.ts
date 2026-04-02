import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

const getTile = vi.fn();
const redisGet = vi.fn();

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: redisGet,
  })),
}));

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
  },
}));

vi.mock('../services/tile.service.js', () => ({
  tileService: {
    getTile,
  },
}));

const { default: tilesRoutes } = await import('../routes/tiles.routes.js');

describe('tilesRoutes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    redisGet.mockResolvedValue(null);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves a cached tile as image/png', async () => {
    getTile.mockResolvedValueOnce(Buffer.from([1, 2, 3]));

    const res = await app.inject({
      method: 'GET',
      url: '/api/tiles/12/654/1583.png',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(getTile).toHaveBeenCalledWith(12, 654, 1583);
  });

  it('returns 404 when the tile is not available', async () => {
    getTile.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/tiles/12/654/1583.png',
    });

    expect(res.statusCode).toBe(404);
  });
});

async function buildApp() {
  const app = Fastify();
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(tilesRoutes);
  return app;
}
