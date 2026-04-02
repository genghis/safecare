import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../config.js', () => ({
  config: {
    OSRM_URL: 'http://osrm.test:5000',
    TILE_URL_TEMPLATE: 'https://tiles.internal/{z}/{x}/{y}.png',
    TILE_SUBDOMAINS: ['a', 'b', 'c'],
    TILE_MIN_ZOOM: 12,
    TILE_MAX_ZOOM: 16,
  },
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { RoutingService } = await import('../services/routing.service.js');
const { config } = await import('../config.js');

describe('RoutingService', () => {
  let service: InstanceType<typeof RoutingService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoutingService();
    config.TILE_URL_TEMPLATE = 'https://tiles.internal/{z}/{x}/{y}.png';
  });

  describe('getRoute', () => {
    const stops = [
      { lat: 41.8781, lng: -87.6298 },
      { lat: 41.8827, lng: -87.6233 },
      { lat: 41.8900, lng: -87.6350 },
    ];

    it('calls OSRM with correct coordinate order (lng,lat)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [
            {
              geometry: {
                type: 'LineString',
                coordinates: [[-87.6298, 41.8781], [-87.6233, 41.8827]],
              },
              distance: 5000,
              duration: 600,
              legs: [
                { distance: 2500, duration: 300, steps: [] },
                { distance: 2500, duration: 300, steps: [] },
              ],
            },
          ],
        }),
      });

      const result = await service.getRoute(stops);

      const url = mockFetch.mock.calls[0][0];
      // OSRM uses lng,lat ordering
      expect(url).toContain('-87.6298,41.8781');
      expect(url).toContain('-87.6233,41.8827');
      expect(url).toContain('geometries=geojson');
      expect(url).toContain('overview=full');
    });

    it('returns route data on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [
            {
              geometry: { type: 'LineString', coordinates: [] },
              distance: 5000,
              duration: 600,
              legs: [],
            },
          ],
        }),
      });

      const result = await service.getRoute(stops);
      expect(result).not.toBeNull();
      expect(result!.distance).toBe(5000);
      expect(result!.duration).toBe(600);
    });

    it('returns null on OSRM error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await service.getRoute(stops);
      expect(result).toBeNull();
    });

    it('returns null on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.getRoute(stops);
      expect(result).toBeNull();
    });

    it('returns null for fewer than 2 stops', async () => {
      const result = await service.getRoute([{ lat: 41.8781, lng: -87.6298 }]);
      expect(result).toBeNull();
    });
  });

  describe('getTileBounds', () => {
    const stops = [
      { lat: 41.8, lng: -87.7 },
      { lat: 42.0, lng: -87.5 },
    ];

    it('computes bounding box with padding', () => {
      const bounds = service.getTileBounds(stops, 0.02);

      expect(bounds.south).toBeCloseTo(41.78, 2);
      expect(bounds.north).toBeCloseTo(42.02, 2);
      expect(bounds.west).toBeCloseTo(-87.72, 2);
      expect(bounds.east).toBeCloseTo(-87.48, 2);
    });

    it('uses default padding', () => {
      const bounds = service.getTileBounds(stops);

      // Default padding is 0.02
      expect(bounds.south).toBeLessThan(41.8);
      expect(bounds.north).toBeGreaterThan(42.0);
    });
  });

  describe('getTileUrls', () => {
    it('generates tile URLs for given bounds', () => {
      const bounds = {
        south: 41.85,
        west: -87.65,
        north: 41.90,
        east: -87.60,
      };

      const urls = service.getTileUrls(bounds, 14, 14);

      expect(urls.length).toBeGreaterThan(0);
      urls.forEach((url: string) => {
        expect(url).toMatch(/^https:\/\/tiles\.internal\/14\/\d+\/\d+\.png$/);
      });
    });

    it('generates more tiles at higher zoom', () => {
      const bounds = {
        south: 41.85,
        west: -87.65,
        north: 41.90,
        east: -87.60,
      };

      const z14 = service.getTileUrls(bounds, 14, 14);
      const z15 = service.getTileUrls(bounds, 15, 15);

      expect(z15.length).toBeGreaterThan(z14.length);
    });

    it('can target the local SafeCare tile endpoint', () => {
      const bounds = {
        south: 41.85,
        west: -87.65,
        north: 41.90,
        east: -87.60,
      };

      const urls = service.getTileUrls(
        bounds,
        14,
        14,
        'https://office.example.org/api/tiles/{z}/{x}/{y}.png',
      );

      expect(urls.length).toBeGreaterThan(0);
      urls.forEach((url: string) => {
        expect(url).toMatch(/^https:\/\/office\.example\.org\/api\/tiles\/14\/\d+\/\d+\.png$/);
      });
    });

    it('returns empty for empty bounds', () => {
      config.TILE_URL_TEMPLATE = '';
      const bounds = { south: 0, west: 0, north: 0, east: 0 };
      const urls = service.getTileUrls(bounds, 14, 14);
      expect(urls).toEqual([]);
    });
  });

  describe('boundsIncludeTile', () => {
    it('accepts tiles within the configured operating region', () => {
      const bounds = {
        south: 41.85,
        west: -87.65,
        north: 41.90,
        east: -87.60,
      };
      const [tile] = service.getTileCoordinates(bounds, 14, 14);

      expect(service.boundsIncludeTile(bounds, tile.z, tile.x, tile.y)).toBe(true);
    });

    it('rejects tiles far outside the configured operating region', () => {
      const bounds = {
        south: 41.85,
        west: -87.65,
        north: 41.90,
        east: -87.60,
      };

      expect(service.boundsIncludeTile(bounds, 14, 0, 0)).toBe(false);
    });
  });
});
