import { describe, it, expect } from 'vitest';
import {
  VEHICLE_SIZES,
  DAYS_OF_WEEK,
  TEAM_NAMES,
  DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES,
  MAX_DELIVERY_RETENTION_HOURS,
  ORPHANED_FOOD_ALERT_MINUTES,
} from '../constants';

describe('VEHICLE_SIZES', () => {
  const expectedKeys = ['compact', 'sedan', 'suv', 'minivan', 'truck'];

  it('has exactly 5 entries (compact, sedan, suv, minivan, truck)', () => {
    expect(Object.keys(VEHICLE_SIZES)).toEqual(expectedKeys);
  });

  it('each vehicle size has a label and defaultMaxDeliveries > 0', () => {
    for (const key of expectedKeys) {
      const entry = VEHICLE_SIZES[key];
      expect(entry.label).toBeTruthy();
      expect(typeof entry.label).toBe('string');
      expect(entry.defaultMaxDeliveries).toBeGreaterThan(0);
    }
  });

  it('vehicle sizes are ordered by capacity (compact < sedan < suv < minivan < truck)', () => {
    const capacities = expectedKeys.map(
      (k) => VEHICLE_SIZES[k].defaultMaxDeliveries
    );
    for (let i = 1; i < capacities.length; i++) {
      expect(capacities[i]).toBeGreaterThan(capacities[i - 1]);
    }
  });
});

describe('DAYS_OF_WEEK', () => {
  it('has exactly 7 entries', () => {
    expect(DAYS_OF_WEEK).toHaveLength(7);
  });
});

describe('TEAM_NAMES', () => {
  it('is non-empty', () => {
    expect(TEAM_NAMES.length).toBeGreaterThan(0);
  });

  it('contains all unique values', () => {
    const unique = new Set(TEAM_NAMES);
    expect(unique.size).toBe(TEAM_NAMES.length);
  });
});

describe('scalar constants', () => {
  it('DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES is a positive number', () => {
    expect(typeof DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES).toBe('number');
    expect(DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES).toBeGreaterThan(0);
  });

  it('MAX_DELIVERY_RETENTION_HOURS is 24', () => {
    expect(MAX_DELIVERY_RETENTION_HOURS).toBe(24);
  });

  it('ORPHANED_FOOD_ALERT_MINUTES is 15', () => {
    expect(ORPHANED_FOOD_ALERT_MINUTES).toBe(15);
  });
});
