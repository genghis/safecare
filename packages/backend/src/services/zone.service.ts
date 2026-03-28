import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deliveryZones } from '../db/schema.js';

interface LatLng {
  lat: number;
  lng: number;
}

export interface CreateZoneInput {
  name: string;
  color?: string;
  polygon: LatLng[];
}

export interface UpdateZoneInput {
  name?: string;
  color?: string;
  polygon?: LatLng[];
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if the point (lat, lng) is inside the polygon.
 */
function pointInPolygon(lat: number, lng: number, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (
      (polygon[i].lng > lng) !== (polygon[j].lng > lng) &&
      lat <
        ((polygon[j].lat - polygon[i].lat) * (lng - polygon[i].lng)) /
          (polygon[j].lng - polygon[i].lng) +
          polygon[i].lat
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Calculate the centroid of a polygon defined by an array of lat/lng points.
 */
function calculateCentroid(polygon: LatLng[]): LatLng {
  let latSum = 0;
  let lngSum = 0;
  for (const point of polygon) {
    latSum += point.lat;
    lngSum += point.lng;
  }
  return {
    lat: latSum / polygon.length,
    lng: lngSum / polygon.length,
  };
}

export class ZoneService {
  /**
   * Create a new delivery zone. Auto-calculates center from polygon centroid.
   */
  async create(data: CreateZoneInput) {
    const center = calculateCentroid(data.polygon);

    const result = await db
      .insert(deliveryZones)
      .values({
        name: data.name,
        color: data.color ?? '#3B82F6',
        polygon: JSON.stringify(data.polygon),
        centerLat: center.lat.toString(),
        centerLng: center.lng.toString(),
      })
      .returning();

    return result[0];
  }

  /**
   * List all active delivery zones.
   */
  async list() {
    return db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.active, true));
  }

  /**
   * Find a single zone by id.
   */
  async findById(id: string) {
    const rows = await db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.id, id));

    return rows[0] ?? null;
  }

  /**
   * Update a zone's name, color, and/or polygon.
   * If polygon is updated, center is recalculated.
   */
  async update(id: string, data: UpdateZoneInput) {
    const updates: Record<string, any> = {};

    if (data.name !== undefined) updates.name = data.name;
    if (data.color !== undefined) updates.color = data.color;
    if (data.polygon !== undefined) {
      updates.polygon = JSON.stringify(data.polygon);
      const center = calculateCentroid(data.polygon);
      updates.centerLat = center.lat.toString();
      updates.centerLng = center.lng.toString();
    }

    if (Object.keys(updates).length === 0) return null;

    const result = await db
      .update(deliveryZones)
      .set(updates)
      .where(eq(deliveryZones.id, id))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Soft-delete a zone by setting active=false.
   */
  async deactivate(id: string) {
    const result = await db
      .update(deliveryZones)
      .set({ active: false })
      .where(eq(deliveryZones.id, id))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Test whether a given lat/lng point falls inside a specific zone.
   */
  async pointInZone(lat: number, lng: number, zoneId: string): Promise<boolean> {
    const zone = await this.findById(zoneId);
    if (!zone) return false;

    const polygon = (typeof zone.polygon === 'string'
      ? JSON.parse(zone.polygon)
      : zone.polygon) as LatLng[];

    return pointInPolygon(lat, lng, polygon);
  }

  /**
   * Find all active zones that contain a given lat/lng point.
   */
  async findZonesForPoint(lat: number, lng: number) {
    const zones = await this.list();

    return zones.filter((zone) => {
      const polygon = (typeof zone.polygon === 'string'
        ? JSON.parse(zone.polygon)
        : zone.polygon) as LatLng[];

      return pointInPolygon(lat, lng, polygon);
    });
  }
}

export const zoneService = new ZoneService();
