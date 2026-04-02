import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../config.js', () => ({
  config: {
    GEOCODING_URL: 'https://nominatim.test',
  },
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks
const { GeocodeService } = await import('../services/geocode.service.js');

describe('GeocodeService', () => {
  let service: InstanceType<typeof GeocodeService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GeocodeService();
  });

  describe('search', () => {
    it('sends correct request to Nominatim', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            display_name: '123 Main St, Chicago, IL',
            lat: '41.8781',
            lon: '-87.6298',
            type: 'house',
            importance: 0.5,
          },
        ],
      });

      const results = await service.search('123 Main St Chicago');

      expect(mockFetch).toHaveBeenCalledOnce();
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('nominatim.test/search');
      expect(url).toContain('q=123+Main+St+Chicago');
      expect(url).toContain('format=jsonv2');

      const opts = mockFetch.mock.calls[0][1];
      expect(opts.headers['User-Agent']).toContain('SafeCare');
    });

    it('maps Nominatim response correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            display_name: '123 Main St, Chicago, IL',
            lat: '41.8781',
            lon: '-87.6298',
            type: 'house',
            importance: 0.75,
          },
        ],
      });

      const results = await service.search('123 Main St');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        displayName: '123 Main St, Chicago, IL',
        lat: 41.8781,
        lng: -87.6298,
        type: 'house',
        importance: 0.75,
      });
    });

    it('returns empty array on empty results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const results = await service.search('nonexistent place xyz');
      expect(results).toEqual([]);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(service.search('test')).rejects.toThrow(
        'Geocoding search failed: 500',
      );
    });

    it('fails closed instead of falling back to a public geocoder', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(service.search('test')).rejects.toThrow('Connection refused');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('respects limit parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await service.search('test', 3);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=3');
    });
  });

  describe('reverse', () => {
    it('sends correct request to Nominatim', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          display_name: '123 Main St, Chicago, IL',
          lat: '41.8781',
          lon: '-87.6298',
        }),
      });

      // Wait for rate limit from previous tests
      await new Promise((r) => setTimeout(r, 1200));
      const result = await service.reverse(41.8781, -87.6298);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('nominatim.test/reverse');
      expect(url).toContain('lat=41.8781');
      expect(url).toContain('lon=-87.6298');
    });

    it('maps reverse response correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          display_name: '456 Oak Ave, Detroit, MI',
          lat: '42.3314',
          lon: '-83.0458',
        }),
      });

      await new Promise((r) => setTimeout(r, 1200));
      const result = await service.reverse(42.3314, -83.0458);

      expect(result).toEqual({
        displayName: '456 Oak Ave, Detroit, MI',
        lat: 42.3314,
        lng: -83.0458,
      });
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await new Promise((r) => setTimeout(r, 1200));
      await expect(service.reverse(0, 0)).rejects.toThrow(
        'Reverse geocoding failed: 404',
      );
    });
  });
});
