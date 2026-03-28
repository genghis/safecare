import { eq, and, sql, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deliveries, recipients } from '../db/schema.js';
import { config } from '../config.js';
import { driverService } from './driver.service.js';
import { zoneService } from './zone.service.js';
import type {
  DistributionProposal,
  DistributionAssignment,
  UnassignedDelivery,
  VehicleSize,
  AvailabilitySlot,
  DayOfWeek,
} from '@safecare/shared';
import { VEHICLE_SIZES } from '@safecare/shared';

interface DeliveryWithDetails {
  deliveryId: string;
  recipientName: string;
  address: string;
  lat: number;
  lng: number;
  notes: string;
}

interface DriverWithDetails {
  id: string;
  name: string;
  vehicleSize: VehicleSize;
  maxDeliveries: number;
  deliveryZoneIds: string[];
}

interface ScoredPair {
  deliveryIndex: number;
  driverIndex: number;
  score: number;
}

// In-memory store for active proposals (keyed by sessionId)
const proposalCache = new Map<string, {
  assignments: Map<string, DeliveryWithDetails[]>; // driverId -> deliveries
  drivers: DriverWithDetails[];
  allDeliveries: DeliveryWithDetails[];
  unassigned: UnassignedDelivery[];
  warnings: string[];
}>();

/**
 * Haversine distance between two lat/lng points, in kilometres.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Sort stops using nearest-neighbour TSP heuristic.
 * Starts from the first stop and always visits the nearest unvisited stop.
 */
function nearestNeighbourSort(stops: DeliveryWithDetails[]): DeliveryWithDetails[] {
  if (stops.length <= 1) return [...stops];

  const remaining = [...stops];
  const sorted: DeliveryWithDetails[] = [];

  // Start with the first stop
  sorted.push(remaining.splice(0, 1)[0]);

  while (remaining.length > 0) {
    const last = sorted[sorted.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(
        last.lat,
        last.lng,
        remaining[i].lat,
        remaining[i].lng,
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    sorted.push(remaining.splice(nearestIdx, 1)[0]);
  }

  return sorted;
}

/**
 * Build a DistributionAssignment from a driver and their sorted deliveries.
 */
function buildAssignment(
  driver: DriverWithDetails,
  sortedStops: DeliveryWithDetails[],
): DistributionAssignment {
  let totalDistance = 0;
  const stopsWithDistance = sortedStops.map((stop, i) => {
    let distanceFromPrev = 0;
    if (i > 0) {
      distanceFromPrev = haversineDistance(
        sortedStops[i - 1].lat,
        sortedStops[i - 1].lng,
        stop.lat,
        stop.lng,
      );
      totalDistance += distanceFromPrev;
    }
    return {
      deliveryId: stop.deliveryId,
      recipientName: stop.recipientName,
      address: stop.address,
      lat: stop.lat,
      lng: stop.lng,
      notes: stop.notes,
      distanceFromPrev: Math.round(distanceFromPrev * 100) / 100,
    };
  });

  // 3 min per delivery + driving time at 30 km/h
  const drivingTimeMinutes = (totalDistance / 30) * 60;
  const deliveryTimeMinutes = sortedStops.length * 3;
  const estimatedTime = Math.round(drivingTimeMinutes + deliveryTimeMinutes);

  return {
    driverId: driver.id,
    driverName: driver.name,
    vehicleSize: driver.vehicleSize,
    maxDeliveries: driver.maxDeliveries,
    deliveries: stopsWithDistance,
    totalDistance: Math.round(totalDistance * 100) / 100,
    estimatedTime,
    loadPercent: Math.round((sortedStops.length / driver.maxDeliveries) * 100),
  };
}

/**
 * Build a full DistributionProposal from the cache state.
 */
function buildProposalFromCache(
  sessionId: string,
  cache: NonNullable<ReturnType<typeof proposalCache.get>>,
): DistributionProposal {
  const assignments: DistributionAssignment[] = [];

  for (const driver of cache.drivers) {
    const driverDeliveries = cache.assignments.get(driver.id) ?? [];
    if (driverDeliveries.length === 0) continue;

    const sorted = nearestNeighbourSort(driverDeliveries);
    // Update cache with sorted order
    cache.assignments.set(driver.id, sorted);
    assignments.push(buildAssignment(driver, sorted));
  }

  return {
    sessionId,
    assignments,
    unassigned: cache.unassigned,
    warnings: cache.warnings,
  };
}

export class DistributionService {
  /**
   * Generate a distribution proposal for a dispatch session.
   *
   * Algorithm:
   * 1. Fetch pending deliveries with decrypted addresses
   * 2. Fetch vetted drivers available on the given day
   * 3. Determine zone memberships for each delivery
   * 4. Score driver-delivery pairs and greedily assign
   * 5. Sort each driver's route using nearest-neighbour heuristic
   * 6. Return proposal with assignments, unassigned, and warnings
   */
  async generateProposal(
    sessionId: string,
    dayOfWeek: DayOfWeek,
  ): Promise<DistributionProposal> {
    const warnings: string[] = [];

    // 1. Fetch pending (unassigned) deliveries with decrypted addresses
    const pendingDeliveries = await db
      .select({
        deliveryId: deliveries.id,
        recipientName: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
        address: sql<string>`pgp_sym_decrypt(${deliveries.addressEnc}::bytea, ${config.DEK})`,
        lat: deliveries.lat,
        lng: deliveries.lng,
        notes: deliveries.notes,
      })
      .from(deliveries)
      .leftJoin(recipients, eq(deliveries.recipientId, recipients.id))
      .where(
        and(
          eq(deliveries.dispatchSessionId, sessionId),
          eq(deliveries.status, 'pending'),
          isNull(deliveries.driverId),
        ),
      );

    const allDeliveries: DeliveryWithDetails[] = pendingDeliveries.map((d) => ({
      deliveryId: d.deliveryId,
      recipientName: d.recipientName ?? '',
      address: d.address ?? '',
      lat: parseFloat(d.lat ?? '0'),
      lng: parseFloat(d.lng ?? '0'),
      notes: d.notes ?? '',
    }));

    if (allDeliveries.length === 0) {
      warnings.push('No pending deliveries found for this session.');
    }

    // 2. Fetch vetted drivers available on this day
    const availableDrivers = await driverService.listAvailableForDay(dayOfWeek);

    if (availableDrivers.length === 0) {
      warnings.push(`No vetted drivers available on ${dayOfWeek}.`);
    }

    const driverDetails: DriverWithDetails[] = availableDrivers.map((d) => ({
      id: d.id,
      name: d.name,
      vehicleSize: (d.vehicleSize ?? 'sedan') as VehicleSize,
      maxDeliveries: d.maxDeliveries ?? 5,
      deliveryZoneIds: (d.deliveryZoneIds ?? []) as string[],
    }));

    // 3. Determine which zones each delivery falls in
    const deliveryZoneMap = new Map<number, string[]>(); // delivery index -> zone ids
    for (let i = 0; i < allDeliveries.length; i++) {
      const del = allDeliveries[i];
      const zones = await zoneService.findZonesForPoint(del.lat, del.lng);
      deliveryZoneMap.set(i, zones.map((z) => z.id));
    }

    // 4. Track assignments: driverId -> list of delivery indices
    const driverAssignments = new Map<number, number[]>(); // driver index -> delivery indices
    for (let d = 0; d < driverDetails.length; d++) {
      driverAssignments.set(d, []);
    }

    // 5. Score each driver-delivery pair
    // Count eligible drivers per delivery for constraint ordering
    const eligibleCount: number[] = [];
    for (let i = 0; i < allDeliveries.length; i++) {
      const deliveryZones = deliveryZoneMap.get(i) ?? [];
      let count = 0;
      for (let d = 0; d < driverDetails.length; d++) {
        const driver = driverDetails[d];
        const inDriverZone = driver.deliveryZoneIds.some((zid) =>
          deliveryZones.includes(zid),
        );
        if (inDriverZone && driver.maxDeliveries > 0) count++;
      }
      eligibleCount.push(count);
    }

    // Sort delivery indices by number of eligible drivers (ascending — most constrained first)
    const deliveryOrder = allDeliveries
      .map((_, i) => i)
      .sort((a, b) => eligibleCount[a] - eligibleCount[b]);

    // 6. Greedy assignment loop
    const assignedDeliveries = new Set<number>();
    const unassigned: UnassignedDelivery[] = [];

    for (const delIdx of deliveryOrder) {
      const del = allDeliveries[delIdx];
      const deliveryZones = deliveryZoneMap.get(delIdx) ?? [];

      // Score each driver for this delivery
      let bestDriverIdx = -1;
      let bestScore = -Infinity;

      for (let dIdx = 0; dIdx < driverDetails.length; dIdx++) {
        const driver = driverDetails[dIdx];
        const currentAssignments = driverAssignments.get(dIdx) ?? [];
        let score = 0;

        // Zone match bonus
        const inDriverZone = driver.deliveryZoneIds.some((zid) =>
          deliveryZones.includes(zid),
        );
        if (inDriverZone) {
          score += 10;
        } else {
          score -= 100;
        }

        // Clustering bonus: close to other assigned deliveries
        if (currentAssignments.length > 0) {
          const avgDist =
            currentAssignments.reduce((sum, aIdx) => {
              const assigned = allDeliveries[aIdx];
              return (
                sum + haversineDistance(del.lat, del.lng, assigned.lat, assigned.lng)
              );
            }, 0) / currentAssignments.length;

          // "Close" = under 5 km average distance
          if (avgDist < 5) {
            score += 5;
          }
        }

        // Capacity penalty
        if (currentAssignments.length >= driver.maxDeliveries) {
          score -= 20;
        }

        if (score > bestScore) {
          bestScore = score;
          bestDriverIdx = dIdx;
        }
      }

      // Assign if we found an eligible driver with capacity
      if (
        bestDriverIdx >= 0 &&
        (driverAssignments.get(bestDriverIdx) ?? []).length <
          driverDetails[bestDriverIdx].maxDeliveries
      ) {
        driverAssignments.get(bestDriverIdx)!.push(delIdx);
        assignedDeliveries.add(delIdx);
      } else {
        // Determine reason
        let reason: string;
        if (driverDetails.length === 0) {
          reason = 'No drivers available';
        } else if (eligibleCount[delIdx] === 0) {
          reason = 'No driver covers this zone';
        } else {
          reason = 'All eligible drivers at capacity';
        }
        unassigned.push({
          deliveryId: del.deliveryId,
          recipientName: del.recipientName,
          address: del.address,
          lat: del.lat,
          lng: del.lng,
          reason,
        });
      }
    }

    // 7. Build assignments with nearest-neighbour sorting
    const assignmentsMap = new Map<string, DeliveryWithDetails[]>();
    for (const [dIdx, delIndices] of driverAssignments) {
      const driver = driverDetails[dIdx];
      if (delIndices.length === 0) continue;

      const driverDeliveries = delIndices.map((i) => allDeliveries[i]);
      assignmentsMap.set(driver.id, driverDeliveries);
    }

    // Warn about unbalanced loads
    for (const [dIdx, delIndices] of driverAssignments) {
      const driver = driverDetails[dIdx];
      const loadPercent = (delIndices.length / driver.maxDeliveries) * 100;
      if (loadPercent > 90 && delIndices.length > 0) {
        warnings.push(
          `Driver ${driver.name} is at ${Math.round(loadPercent)}% capacity (${delIndices.length}/${driver.maxDeliveries}).`,
        );
      }
    }

    if (unassigned.length > 0) {
      warnings.push(
        `${unassigned.length} delivery(ies) could not be assigned.`,
      );
    }

    // Store in cache for subsequent operations
    proposalCache.set(sessionId, {
      assignments: assignmentsMap,
      drivers: driverDetails,
      allDeliveries,
      unassigned,
      warnings,
    });

    return buildProposalFromCache(sessionId, proposalCache.get(sessionId)!);
  }

  /**
   * Move a single delivery from one driver to another within an active proposal.
   * Re-runs nearest-neighbour sorting for both affected drivers.
   */
  async moveDelivery(
    sessionId: string,
    deliveryId: string,
    fromDriverId: string,
    toDriverId: string,
  ): Promise<DistributionProposal> {
    const cache = proposalCache.get(sessionId);
    if (!cache) {
      throw new Error(`No active proposal found for session ${sessionId}`);
    }

    const fromDeliveries = cache.assignments.get(fromDriverId);
    if (!fromDeliveries) {
      throw new Error(`Driver ${fromDriverId} has no assignments in this proposal`);
    }

    const deliveryIndex = fromDeliveries.findIndex(
      (d) => d.deliveryId === deliveryId,
    );
    if (deliveryIndex === -1) {
      throw new Error(
        `Delivery ${deliveryId} not found in driver ${fromDriverId}'s assignments`,
      );
    }

    // Remove from source driver
    const [delivery] = fromDeliveries.splice(deliveryIndex, 1);

    // Add to target driver
    const toDeliveries = cache.assignments.get(toDriverId) ?? [];
    toDeliveries.push(delivery);
    cache.assignments.set(toDriverId, toDeliveries);

    // Check capacity warning
    const toDriver = cache.drivers.find((d) => d.id === toDriverId);
    if (toDriver && toDeliveries.length > toDriver.maxDeliveries) {
      cache.warnings.push(
        `Warning: Driver ${toDriver.name} now exceeds capacity (${toDeliveries.length}/${toDriver.maxDeliveries}).`,
      );
    }

    return buildProposalFromCache(sessionId, cache);
  }

  /**
   * Adjust a driver's maxDeliveries for this proposal.
   * If the driver is now over capacity, excess deliveries spill to other drivers.
   */
  async adjustDriverCapacity(
    sessionId: string,
    driverId: string,
    newMax: number,
  ): Promise<DistributionProposal> {
    const cache = proposalCache.get(sessionId);
    if (!cache) {
      throw new Error(`No active proposal found for session ${sessionId}`);
    }

    const driver = cache.drivers.find((d) => d.id === driverId);
    if (!driver) {
      throw new Error(`Driver ${driverId} not found in this proposal`);
    }

    driver.maxDeliveries = newMax;

    const currentDeliveries = cache.assignments.get(driverId) ?? [];
    if (currentDeliveries.length > newMax) {
      // Spill excess deliveries
      const excess = currentDeliveries.splice(newMax);

      for (const delivery of excess) {
        let reassigned = false;

        // Find another driver with capacity
        for (const otherDriver of cache.drivers) {
          if (otherDriver.id === driverId) continue;
          const otherDeliveries = cache.assignments.get(otherDriver.id) ?? [];
          if (otherDeliveries.length < otherDriver.maxDeliveries) {
            otherDeliveries.push(delivery);
            cache.assignments.set(otherDriver.id, otherDeliveries);
            reassigned = true;
            break;
          }
        }

        if (!reassigned) {
          cache.unassigned.push({
            deliveryId: delivery.deliveryId,
            recipientName: delivery.recipientName,
            address: delivery.address,
            lat: delivery.lat,
            lng: delivery.lng,
            reason: 'Spilled from capacity reduction — no other driver available',
          });
        }
      }
    }

    return buildProposalFromCache(sessionId, cache);
  }

  /**
   * Remove a driver (e.g. no-show) from the proposal and redistribute
   * their deliveries to remaining drivers.
   */
  async removeDriver(
    sessionId: string,
    driverId: string,
  ): Promise<DistributionProposal> {
    const cache = proposalCache.get(sessionId);
    if (!cache) {
      throw new Error(`No active proposal found for session ${sessionId}`);
    }

    const driverIndex = cache.drivers.findIndex((d) => d.id === driverId);
    if (driverIndex === -1) {
      throw new Error(`Driver ${driverId} not found in this proposal`);
    }

    const removedDriver = cache.drivers[driverIndex];
    const orphanedDeliveries = cache.assignments.get(driverId) ?? [];

    // Remove driver from cache
    cache.drivers.splice(driverIndex, 1);
    cache.assignments.delete(driverId);

    cache.warnings.push(
      `Driver ${removedDriver.name} removed. Redistributing ${orphanedDeliveries.length} delivery(ies).`,
    );

    // Redistribute orphaned deliveries
    for (const delivery of orphanedDeliveries) {
      let bestDriverId: string | null = null;
      let bestScore = -Infinity;

      for (const driver of cache.drivers) {
        const driverDeliveries = cache.assignments.get(driver.id) ?? [];
        if (driverDeliveries.length >= driver.maxDeliveries) continue;

        // Score: prefer drivers whose current deliveries are close
        let score = 0;
        if (driverDeliveries.length > 0) {
          const avgDist =
            driverDeliveries.reduce(
              (sum, d) =>
                sum + haversineDistance(delivery.lat, delivery.lng, d.lat, d.lng),
              0,
            ) / driverDeliveries.length;
          if (avgDist < 5) score += 5;
        }

        // Prefer drivers with more remaining capacity
        score +=
          (driver.maxDeliveries - driverDeliveries.length) /
          driver.maxDeliveries;

        if (score > bestScore) {
          bestScore = score;
          bestDriverId = driver.id;
        }
      }

      if (bestDriverId) {
        const targetDeliveries = cache.assignments.get(bestDriverId) ?? [];
        targetDeliveries.push(delivery);
        cache.assignments.set(bestDriverId, targetDeliveries);
      } else {
        cache.unassigned.push({
          deliveryId: delivery.deliveryId,
          recipientName: delivery.recipientName,
          address: delivery.address,
          lat: delivery.lat,
          lng: delivery.lng,
          reason: 'No remaining driver with capacity after driver removal',
        });
      }
    }

    return buildProposalFromCache(sessionId, cache);
  }
}

export const distributionService = new DistributionService();
