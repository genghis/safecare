import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../config.js', () => ({
  config: {
    TILE_URL_TEMPLATE: '',
    TILE_DOWNLOAD_URL_TEMPLATE: 'https://tiles.upstream.test/{z}/{x}/{y}.png',
    TILE_STORAGE_PATH: '/tmp/safecare-tiles-test',
    TILE_SUBDOMAINS: ['a', 'b', 'c'],
    TILE_DOWNLOAD_SUBDOMAINS: [],
    TILE_MIN_ZOOM: 12,
    TILE_MAX_ZOOM: 16,
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { TileService } = await import('../services/tile.service.js');
const { config } = await import('../config.js');
const { routingService } = await import('../services/routing.service.js');

describe('TileService', () => {
  let service: InstanceType<typeof TileService>;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(path.join(tmpdir(), 'safecare-tiles-'));
    Object.assign(config as Record<string, unknown>, {
      TILE_STORAGE_PATH: tempDir,
      TILE_URL_TEMPLATE: '',
      TILE_DOWNLOAD_URL_TEMPLATE: 'https://tiles.upstream.test/{z}/{x}/{y}.png',
    });
    service = new TileService();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('builds a local SafeCare tile template when no override is configured', () => {
    expect(service.getPublicTileUrlTemplate('https://office.example.org')).toBe(
      'https://office.example.org/api/tiles/{z}/{x}/{y}.png',
    );
  });

  it('fetches and caches a missing tile locally', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    });

    const first = await service.getTile(12, 654, 1583);
    const second = await service.getTile(12, 654, 1583);

    expect(first).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(second).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(mockFetch).toHaveBeenCalledOnce();

    const cached = await readFile(path.join(tempDir, '12', '654', '1583.png'));
    expect(cached).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('serves only local tiles when no upstream tile source is configured', async () => {
    Object.assign(config as Record<string, unknown>, {
      TILE_DOWNLOAD_URL_TEMPLATE: '',
    });

    await mkdir(path.join(tempDir, '12', '654'), { recursive: true });
    await writeFile(path.join(tempDir, '12', '654', '1583.png'), Buffer.from([9, 8, 7]));

    const existingTile = await service.getTile(12, 654, 1583);
    const missingTile = await service.getTile(12, 654, 1584);

    expect(existingTile).toEqual(Buffer.from([9, 8, 7]));
    expect(missingTile).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports cached, fetched, and missing tiles during prefetch', async () => {
    const bounds = { south: 41.7, west: -87.8, north: 42.0, east: -87.4 };
    const coordinates = routingService.getTileCoordinates(bounds, 12, 12);
    expect(coordinates.length).toBeGreaterThan(1);

    const firstTile = coordinates[0];
    await mkdir(path.join(tempDir, String(firstTile.z), String(firstTile.x)), {
      recursive: true,
    });
    await writeFile(
      path.join(tempDir, String(firstTile.z), String(firstTile.x), `${firstTile.y}.png`),
      Buffer.from([5]),
    );

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([6]).buffer,
    });

    const result = await service.prefetchTiles(bounds, 12, 12);

    expect(result.total).toBeGreaterThan(0);
    expect(result.cached).toBeGreaterThan(0);
    expect(result.fetched).toBeGreaterThan(0);
    expect(result.missing).toBe(0);
    expect(result.cached + result.fetched + result.missing).toBe(result.total);
  });
});
