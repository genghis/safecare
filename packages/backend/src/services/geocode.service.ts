import { config } from '../config.js';

export interface GeocodingResult {
  displayName: string;
  lat: number;
  lng: number;
  type: string;
  importance: number;
}

export interface ReverseGeocodingResult {
  displayName: string;
  lat: number;
  lng: number;
}

const USER_AGENT = 'SafeCare/1.0 (mutual-aid-delivery)';
const RATE_LIMIT_MS = 1100; // Nominatim requires max 1 req/sec
const PUBLIC_NOMINATIM = 'https://nominatim.openstreetmap.org';

export class GeocodeService {
  private lastRequestAt = 0;

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  // Attempt the request against `base`. Returns parsed JSON on 2xx, throws
  // on any error so callers can fall through to a fallback base.
  private async fetchJson(base: string, path: string, params: URLSearchParams) {
    const url = new URL(path, base);
    for (const [k, v] of params) url.searchParams.set(k, v);
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`Nominatim ${path} failed: ${response.status} (${base})`);
    }
    return response.json();
  }

  async search(query: string, limit = 5, viewbox?: string): Promise<GeocodingResult[]> {
    await this.rateLimit();

    const params = new URLSearchParams();
    params.set('q', query);
    params.set('format', 'jsonv2');
    params.set('limit', String(limit));
    params.set('addressdetails', '1');
    params.set('countrycodes', 'us');
    if (viewbox) {
      params.set('viewbox', viewbox);
      params.set('bounded', '0');
    }

    let data: any[];
    try {
      data = (await this.fetchJson(config.GEOCODING_URL, '/search', params)) as any[];
    } catch (err) {
      if (!config.USE_PUBLIC_GEOCODE_FALLBACK) throw err;
      data = (await this.fetchJson(PUBLIC_NOMINATIM, '/search', params)) as any[];
    }

    return data.map((item) => ({
      displayName: item.display_name ?? '',
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type ?? '',
      importance: item.importance ?? 0,
    }));
  }

  async reverse(lat: number, lng: number): Promise<ReverseGeocodingResult> {
    await this.rateLimit();

    const params = new URLSearchParams();
    params.set('lat', String(lat));
    params.set('lon', String(lng));
    params.set('format', 'jsonv2');

    let data: any;
    try {
      data = await this.fetchJson(config.GEOCODING_URL, '/reverse', params);
    } catch (err) {
      if (!config.USE_PUBLIC_GEOCODE_FALLBACK) throw err;
      data = await this.fetchJson(PUBLIC_NOMINATIM, '/reverse', params);
    }

    return {
      displayName: data.display_name ?? '',
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lon),
    };
  }
}

export const geocodeService = new GeocodeService();
