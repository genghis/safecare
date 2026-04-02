import { config } from '../config.js';

interface LatLng {
  lat: number;
  lng: number;
}

interface OsrmLeg {
  distance: number;
  duration: number;
  steps: any[];
}

interface OsrmRoute {
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distance: number;
  duration: number;
  legs: OsrmLeg[];
}

interface OsrmResponse {
  code: string;
  routes: OsrmRoute[];
}

export interface RouteResult {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distance: number; // meters
  duration: number; // seconds
  legs: { distance: number; duration: number; steps: any[] }[];
}

export interface TileBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

export class RoutingService {
  /**
   * Call the OSRM server to compute a driving route through the given stops.
   * Returns null if OSRM is unavailable or returns an error.
   */
  async getRoute(stops: LatLng[]): Promise<RouteResult | null> {
    if (stops.length < 2) return null;

    // OSRM uses lng,lat ordering
    const coordinates = stops.map((s) => `${s.lng},${s.lat}`).join(';');
    const url = `${config.OSRM_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as OsrmResponse;

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        return null;
      }

      const route = data.routes[0];

      return {
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        legs: route.legs.map((leg) => ({
          distance: leg.distance,
          duration: leg.duration,
          steps: leg.steps,
        })),
      };
    } catch {
      // OSRM unavailable — graceful degradation
      return null;
    }
  }

  /**
   * Compute the bounding box of all stops with an optional padding in degrees.
   */
  getTileBounds(stops: LatLng[], paddingDegrees = 0.02): TileBounds {
    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;

    for (const stop of stops) {
      if (stop.lat < south) south = stop.lat;
      if (stop.lat > north) north = stop.lat;
      if (stop.lng < west) west = stop.lng;
      if (stop.lng > east) east = stop.lng;
    }

    return {
      south: south - paddingDegrees,
      west: west - paddingDegrees,
      north: north + paddingDegrees,
      east: east + paddingDegrees,
    };
  }

  /**
   * Compute the tile coordinates needed to cover the bounding box at the
   * specified zoom levels.
   */
  getTileCoordinates(
    bounds: TileBounds,
    minZoom = config.TILE_MIN_ZOOM,
    maxZoom = config.TILE_MAX_ZOOM,
  ): TileCoordinate[] {
    const coordinates: TileCoordinate[] = [];

    for (let z = minZoom; z <= maxZoom; z++) {
      const { xMin, xMax, yMin, yMax } = this.getTileRange(bounds, z);

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          coordinates.push({ z, x, y });
        }
      }
    }

    return coordinates;
  }

  /**
   * Compute all tile URLs needed to cover the bounding box at the specified
   * zoom levels. Used by the PWA for offline tile pre-caching.
   */
  getTileUrls(
    bounds: TileBounds,
    minZoom = config.TILE_MIN_ZOOM,
    maxZoom = config.TILE_MAX_ZOOM,
    template = config.TILE_URL_TEMPLATE,
  ): string[] {
    if (!template) {
      return [];
    }

    const subdomains = config.TILE_SUBDOMAINS.length > 0 ? config.TILE_SUBDOMAINS : ['a', 'b', 'c'];
    let subdomainIdx = 0;

    const urls: string[] = [];
    for (const { z, x, y } of this.getTileCoordinates(bounds, minZoom, maxZoom)) {
      const s = subdomains[subdomainIdx % subdomains.length];
      subdomainIdx++;
      urls.push(
        template
          .replaceAll('{s}', s)
          .replaceAll('{z}', String(z))
          .replaceAll('{x}', String(x))
          .replaceAll('{y}', String(y)),
      );
    }

    return urls;
  }

  boundsIncludeTile(
    bounds: TileBounds,
    z: number,
    x: number,
    y: number,
    paddingDegrees = 0.05,
  ): boolean {
    const expandedBounds = {
      south: bounds.south - paddingDegrees,
      west: bounds.west - paddingDegrees,
      north: bounds.north + paddingDegrees,
      east: bounds.east + paddingDegrees,
    };
    const { xMin, xMax, yMin, yMax } = this.getTileRange(expandedBounds, z);

    return x >= xMin && x <= xMax && y >= yMin && y <= yMax;
  }

  private getTileRange(bounds: TileBounds, zoom: number): {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  } {
    return {
      xMin: this.lngToTileX(bounds.west, zoom),
      xMax: this.lngToTileX(bounds.east, zoom),
      yMin: this.latToTileY(bounds.north, zoom), // north = smaller y
      yMax: this.latToTileY(bounds.south, zoom), // south = larger y
    };
  }

  /**
   * Slippy map tilename formula: longitude to tile X.
   */
  private lngToTileX(lng: number, zoom: number): number {
    return Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  }

  /**
   * Slippy map tilename formula: latitude to tile Y.
   */
  private latToTileY(lat: number, zoom: number): number {
    const latRad = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        Math.pow(2, zoom),
    );
  }
}

export const routingService = new RoutingService();
