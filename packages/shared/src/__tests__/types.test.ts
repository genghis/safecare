import { describe, it, expect } from 'vitest';
import type {
  VehicleSize,
  DayOfWeek,
  AvailabilitySlot,
  DeliveryStatus,
  RoutePacket,
} from '../types';

/**
 * These tests verify type correctness at compile time via satisfies/assignment,
 * while also providing runtime assertions that the types work as expected.
 */

describe('VehicleSize', () => {
  it('accepts valid values and type narrows correctly', () => {
    const sizes: VehicleSize[] = ['compact', 'sedan', 'suv', 'minivan', 'truck'];
    expect(sizes).toHaveLength(5);

    // Each value round-trips through the union
    for (const s of sizes) {
      const narrowed: VehicleSize = s;
      expect(typeof narrowed).toBe('string');
    }
  });
});

describe('DayOfWeek', () => {
  it('union is exactly 7 values', () => {
    const days: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    expect(days).toHaveLength(7);

    // Verify each is assignable to DayOfWeek
    for (const d of days) {
      const assigned: DayOfWeek = d;
      expect(assigned).toBe(d);
    }
  });
});

describe('AvailabilitySlot', () => {
  it('has required day, startTime, endTime', () => {
    const slot: AvailabilitySlot = {
      day: 'mon',
      startTime: '09:00',
      endTime: '17:00',
    };

    expect(slot.day).toBe('mon');
    expect(slot.startTime).toBe('09:00');
    expect(slot.endTime).toBe('17:00');

    // Verify all keys are present
    expect(Object.keys(slot).sort()).toEqual(['day', 'endTime', 'startTime']);
  });
});

describe('DeliveryStatus', () => {
  it('includes all expected statuses', () => {
    const statuses: DeliveryStatus[] = [
      'pending',
      'assigned',
      'released',
      'in_transit',
      'delivered',
      'acknowledged',
      'failed',
    ];
    expect(statuses).toHaveLength(7);

    // Each value is assignable to DeliveryStatus
    for (const s of statuses) {
      const assigned: DeliveryStatus = s;
      expect(assigned).toBe(s);
    }
  });
});

describe('RoutePacket', () => {
  it('has required fields (sessionId, driverId, stops, expiresAt)', () => {
    const packet: RoutePacket = {
      sessionId: 'sess-1',
      driverId: 'drv-1',
      stops: [
        {
          deliveryId: 'del-1',
          address: '123 Main St',
          lat: 40.0,
          lng: -74.0,
          notes: 'Ring bell',
          recipientName: 'Alice',
          sequence: 1,
        },
      ],
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    };

    expect(packet.sessionId).toBe('sess-1');
    expect(packet.driverId).toBe('drv-1');
    expect(packet.stops).toHaveLength(1);
    expect(packet.expiresAt).toBeInstanceOf(Date);

    // Verify stop shape
    const stop = packet.stops[0];
    expect(stop.deliveryId).toBe('del-1');
    expect(stop.sequence).toBe(1);
  });
});
