import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { routingService, type TileBounds } from './routing.service.js';

const TILE_USER_AGENT = 'SafeCare/1.0 (tile-cache)';
const DEFAULT_TILE_BATCH_SIZE = 8;

export interface TilePrefetchResult {
  total: number;
  cached: number;
  fetched: number;
  missing: number;
}

type TileLoadResult = {
  source: 'cached' | 'fetched' | 'missing';
  tile: Buffer | null;
};

export class TileService {
  private readonly inFlight = new Map<string, Promise<Buffer | null>>();

  getPublicTileUrlTemplate(baseUrl: string): string {
    const configuredTemplate = config.TILE_URL_TEMPLATE.trim();
    if (configuredTemplate) {
      return configuredTemplate;
    }

    return `${baseUrl.replace(/\/$/, '')}/api/tiles/{z}/{x}/{y}.png`;
  }

  hasUpstreamTileSource(): boolean {
    return config.TILE_DOWNLOAD_URL_TEMPLATE.trim().length > 0;
  }

  async getTile(z: number, x: number, y: number): Promise<Buffer | null> {
    const result = await this.loadTile(z, x, y);
    return result.tile;
  }

  async prefetchTiles(
    bounds: TileBounds,
    minZoom = config.TILE_MIN_ZOOM,
    maxZoom = config.TILE_MAX_ZOOM,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<TilePrefetchResult> {
    const coordinates = routingService.getTileCoordinates(bounds, minZoom, maxZoom);
    const total = coordinates.length;

    if (total === 0) {
      onProgress?.(0, 0);
      return {
        total: 0,
        cached: 0,
        fetched: 0,
        missing: 0,
      };
    }

    let completed = 0;
    let cached = 0;
    let fetched = 0;
    let missing = 0;

    for (let i = 0; i < total; i += DEFAULT_TILE_BATCH_SIZE) {
      const batch = coordinates.slice(i, i + DEFAULT_TILE_BATCH_SIZE);

      const results = await Promise.all(
        batch.map((tile) => this.loadTile(tile.z, tile.x, tile.y)),
      );

      for (const result of results) {
        if (result.source === 'cached') {
          cached += 1;
        } else if (result.source === 'fetched') {
          fetched += 1;
        } else {
          missing += 1;
        }
      }

      completed += batch.length;
      onProgress?.(Math.min(completed, total), total);
    }

    return {
      total,
      cached,
      fetched,
      missing,
    };
  }

  private buildCacheKey(z: number, x: number, y: number): string {
    return `${z}/${x}/${y}`;
  }

  private getTilePath(z: number, x: number, y: number): string {
    return path.join(config.TILE_STORAGE_PATH, String(z), String(x), `${y}.png`);
  }

  private async readCachedTile(z: number, x: number, y: number): Promise<Buffer | null> {
    try {
      return await readFile(this.getTilePath(z, x, y));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  private async loadTile(z: number, x: number, y: number): Promise<TileLoadResult> {
    const cached = await this.readCachedTile(z, x, y);
    if (cached) {
      return { source: 'cached', tile: cached };
    }

    const fetched = await this.fetchAndCacheTile(z, x, y);
    if (fetched) {
      return { source: 'fetched', tile: fetched };
    }

    return { source: 'missing', tile: null };
  }

  private async fetchAndCacheTile(z: number, x: number, y: number): Promise<Buffer | null> {
    const key = this.buildCacheKey(z, x, y);
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const task = (async () => {
      const url = this.buildUpstreamTileUrl(z, x, y);
      if (!url) {
        return null;
      }

      const response = await fetch(url, {
        headers: { 'User-Agent': TILE_USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const filePath = this.getTilePath(z, x, y);

      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);

      return buffer;
    })().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, task);
    return task;
  }

  private buildUpstreamTileUrl(z: number, x: number, y: number): string | null {
    const template = config.TILE_DOWNLOAD_URL_TEMPLATE.trim();
    if (!template) {
      return null;
    }

    const subdomains =
      config.TILE_DOWNLOAD_SUBDOMAINS.length > 0
        ? config.TILE_DOWNLOAD_SUBDOMAINS
        : ['a', 'b', 'c'];
    const subdomain = subdomains[Math.abs(x + y + z) % subdomains.length];

    return template
      .replaceAll('{s}', subdomain)
      .replaceAll('{z}', String(z))
      .replaceAll('{x}', String(x))
      .replaceAll('{y}', String(y));
  }
}

export const tileService = new TileService();
