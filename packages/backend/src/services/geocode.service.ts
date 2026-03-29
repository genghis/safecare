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

  async search(query: string, limit = 5, viewbox?: string): Promise<GeocodingResult[]> {
    await this.rateLimit();

    const url = new URL('/search', config.GEOCODING_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'us');

    // Bias results toward a geographic area (does not exclude results outside)
    if (viewbox) {
      url.searchParams.set('viewbox', viewbox);
      url.searchParams.set('bounded', '0');
    }

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Geocoding search failed: ${response.status}`);
    }

    const data = (await response.json()) as any[];

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

    const url = new URL('/reverse', config.GEOCODING_URL);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('format', 'jsonv2');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoding failed: ${response.status}`);
    }

    const data = (await response.json()) as any;

    return {
      displayName: data.display_name ?? '',
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lon),
    };
  }
}

export const geocodeService = new GeocodeService();
