import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

let selectResults: any[] = [];

vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => selectResults),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => selectResults),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => selectResults),
        })),
      })),
    })),
  },
}));

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret',
    DEK: 'test-dek',
    HMAC_KEY: 'test-hmac-key',
  },
}));

// Mock ioredis to prevent connection attempts
vi.mock('ioredis', () => {
  return { default: vi.fn().mockImplementation(() => ({})) };
});

import { ZoneService } from '../services/zone.service.js';

// ---------------------------------------------------------------------------
// To test the pure geometry functions (pointInPolygon, calculateCentroid)
// which are private, we test them through the ZoneService's public methods
// that use them: pointInZone and findZonesForPoint.
//
// For pointInPolygon we use pointInZone with a mocked zone that has a known polygon.
// For calculateCentroid we use create() and verify the center values.
// ---------------------------------------------------------------------------

describe('Zone Geometry — Point-in-Polygon (ray casting)', () => {
  let zoneService: ZoneService;

  // A simple square polygon: (0,0), (0,10), (10,10), (10,0)
  const squarePolygon = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 0 },
  ];

  // A triangle: (0,0), (5,10), (10,0)
  const trianglePolygon = [
    { lat: 0, lng: 0 },
    { lat: 5, lng: 10 },
    { lat: 10, lng: 0 },
  ];

  // A concave (L-shaped) polygon
  const concavePolygon = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 5, lng: 10 },
    { lat: 5, lng: 5 },
    { lat: 10, lng: 5 },
    { lat: 10, lng: 0 },
  ];

  beforeEach(() => {
    zoneService = new ZoneService();
    vi.clearAllMocks();
  });

  describe('Simple square polygon', () => {
    it('point inside a simple square polygon returns true', async () => {
      selectResults = [
        {
          id: 'zone-square',
          polygon: JSON.stringify(squarePolygon),
          active: true,
        },
      ];

      const result = await zoneService.pointInZone(5, 5, 'zone-square');
      expect(result).toBe(true);
    });

    it('point outside a simple square polygon returns false', async () => {
      selectResults = [
        {
          id: 'zone-square',
          polygon: JSON.stringify(squarePolygon),
          active: true,
        },
      ];

      const result = await zoneService.pointInZone(15, 15, 'zone-square');
      expect(result).toBe(false);
    });

    it('point clearly outside (negative coordinates) returns false', async () => {
      selectResults = [
        {
          id: 'zone-square',
          polygon: JSON.stringify(squarePolygon),
          active: true,
        },
      ];

      const result = await zoneService.pointInZone(-5, -5, 'zone-square');
      expect(result).toBe(false);
    });

    it('point on polygon edge (boundary case)', async () => {
      selectResults = [
        {
          id: 'zone-square',
          polygon: JSON.stringify(squarePolygon),
          active: true,
        },
      ];

      // Point on the right edge at (5, 10) — ray casting edge behavior
      // The exact behavior on edges is implementation-defined for ray casting.
      // We just verify it returns a boolean without error.
      const result = await zoneService.pointInZone(5, 10, 'zone-square');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Triangle polygon', () => {
    it('point inside a triangle returns true', async () => {
      selectResults = [
        {
          id: 'zone-tri',
          polygon: JSON.stringify(trianglePolygon),
          active: true,
        },
      ];

      // Center of the triangle is roughly (5, 3.33)
      const result = await zoneService.pointInZone(5, 3, 'zone-tri');
      expect(result).toBe(true);
    });

    it('point outside a triangle returns false', async () => {
      selectResults = [
        {
          id: 'zone-tri',
          polygon: JSON.stringify(trianglePolygon),
          active: true,
        },
      ];

      // Way outside the triangle
      const result = await zoneService.pointInZone(0, 10, 'zone-tri');
      expect(result).toBe(false);
    });
  });

  describe('Complex (concave) polygon', () => {
    it('point inside the concave region returns true', async () => {
      selectResults = [
        {
          id: 'zone-concave',
          polygon: JSON.stringify(concavePolygon),
          active: true,
        },
      ];

      // Point in the bottom-left area of the L shape
      const result = await zoneService.pointInZone(7, 2, 'zone-concave');
      expect(result).toBe(true);
    });

    it('point in the concavity (outside the L) returns false', async () => {
      selectResults = [
        {
          id: 'zone-concave',
          polygon: JSON.stringify(concavePolygon),
          active: true,
        },
      ];

      // Point in the "notch" of the L — this should be outside
      const result = await zoneService.pointInZone(7, 8, 'zone-concave');
      expect(result).toBe(false);
    });
  });

  describe('Non-existent zone', () => {
    it('returns false when zone does not exist', async () => {
      selectResults = []; // No zone found

      const result = await zoneService.pointInZone(5, 5, 'nonexistent-zone');
      expect(result).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Centroid Calculation
// ---------------------------------------------------------------------------

describe('Zone Geometry — Centroid Calculation', () => {
  let zoneService: ZoneService;

  beforeEach(() => {
    zoneService = new ZoneService();
    vi.clearAllMocks();
  });

  it('centroid of a square returns the center', async () => {
    const squarePolygon = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];

    let capturedValues: any = null;
    const { db } = await import('../db/index.js');
    (db.insert as any).mockReturnValue({
      values: vi.fn((vals: any) => {
        capturedValues = vals;
        return {
          returning: vi.fn(() => [
            {
              id: 'zone-new',
              name: 'Test Square',
              polygon: JSON.stringify(squarePolygon),
              centerLat: vals.centerLat,
              centerLng: vals.centerLng,
            },
          ]),
        };
      }),
    });

    await zoneService.create({
      name: 'Test Square',
      polygon: squarePolygon,
    });

    expect(capturedValues).not.toBeNull();
    // The centroid of a square (0,0), (0,10), (10,10), (10,0) is (5, 5)
    expect(parseFloat(capturedValues.centerLat)).toBeCloseTo(5, 5);
    expect(parseFloat(capturedValues.centerLng)).toBeCloseTo(5, 5);
  });

  it('centroid of a triangle returns the average of vertices', async () => {
    const trianglePolygon = [
      { lat: 0, lng: 0 },
      { lat: 6, lng: 12 },
      { lat: 12, lng: 0 },
    ];

    // Expected centroid: (6, 4)
    let capturedValues: any = null;
    const { db } = await import('../db/index.js');
    (db.insert as any).mockReturnValue({
      values: vi.fn((vals: any) => {
        capturedValues = vals;
        return {
          returning: vi.fn(() => [
            {
              id: 'zone-tri',
              name: 'Test Triangle',
              polygon: JSON.stringify(trianglePolygon),
              centerLat: vals.centerLat,
              centerLng: vals.centerLng,
            },
          ]),
        };
      }),
    });

    await zoneService.create({
      name: 'Test Triangle',
      polygon: trianglePolygon,
    });

    expect(capturedValues).not.toBeNull();
    // Average of (0,6,12) = 6, Average of (0,12,0) = 4
    expect(parseFloat(capturedValues.centerLat)).toBeCloseTo(6, 5);
    expect(parseFloat(capturedValues.centerLng)).toBeCloseTo(4, 5);
  });

  it('centroid recalculated on polygon update', async () => {
    const newPolygon = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 20 },
      { lat: 20, lng: 20 },
      { lat: 20, lng: 10 },
    ];

    let capturedUpdates: any = null;
    const { db } = await import('../db/index.js');
    (db.update as any).mockReturnValue({
      set: vi.fn((updates: any) => {
        capturedUpdates = updates;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() => [
              {
                id: 'zone-1',
                name: 'Updated Zone',
                polygon: JSON.stringify(newPolygon),
                centerLat: updates.centerLat,
                centerLng: updates.centerLng,
              },
            ]),
          })),
        };
      }),
    });

    await zoneService.update('zone-1', { polygon: newPolygon });

    expect(capturedUpdates).not.toBeNull();
    // Centroid of (10,10), (10,20), (20,20), (20,10) is (15, 15)
    expect(parseFloat(capturedUpdates.centerLat)).toBeCloseTo(15, 5);
    expect(parseFloat(capturedUpdates.centerLng)).toBeCloseTo(15, 5);
  });
});

// ---------------------------------------------------------------------------
// findZonesForPoint — filtering active zones
// ---------------------------------------------------------------------------

describe('ZoneService — findZonesForPoint', () => {
  let zoneService: ZoneService;

  beforeEach(() => {
    zoneService = new ZoneService();
    vi.clearAllMocks();
  });

  it('returns all active zones that contain the given point', async () => {
    const zone1Polygon = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];

    const zone2Polygon = [
      { lat: 5, lng: 5 },
      { lat: 5, lng: 15 },
      { lat: 15, lng: 15 },
      { lat: 15, lng: 5 },
    ];

    // Both zones are active; point (7, 7) is in both
    selectResults = [
      { id: 'zone-1', polygon: JSON.stringify(zone1Polygon), active: true },
      { id: 'zone-2', polygon: JSON.stringify(zone2Polygon), active: true },
    ];

    const zones = await zoneService.findZonesForPoint(7, 7);
    expect(zones.length).toBe(2);
  });

  it('returns empty array when point is outside all zones', async () => {
    const zonePolygon = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];

    selectResults = [
      { id: 'zone-1', polygon: JSON.stringify(zonePolygon), active: true },
    ];

    const zones = await zoneService.findZonesForPoint(50, 50);
    expect(zones.length).toBe(0);
  });
});
