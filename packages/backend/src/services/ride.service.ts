import { eq, and, sql, gte, lte, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  shifts,
  rideSchedules,
  savedLocations,
  driverPassengerAffinity,
  intakeRequests,
  recipients,
  drivers,
} from '../db/schema.js';
import { config } from '../config.js';
import { encryptField, decryptField, hmacField } from '../db/encryption.js';
import { SHIFT_BOARD_HORIZON_DAYS } from '@safecare/shared';

export class RideService {
  // ========== Shift management ==========

  /** List shifts for a date range with optional status filter */
  async listShifts(opts: {
    from: string;
    to: string;
    status?: string;
    driverId?: string;
    recipientId?: string;
  }) {
    const conditions = [
      gte(shifts.date, opts.from),
      lte(shifts.date, opts.to),
    ];

    if (opts.status) conditions.push(eq(shifts.status, opts.status));
    if (opts.driverId) conditions.push(eq(shifts.driverId, opts.driverId));
    if (opts.recipientId) conditions.push(eq(shifts.recipientId, opts.recipientId));

    return db
      .select()
      .from(shifts)
      .where(and(...conditions))
      .orderBy(asc(shifts.date), asc(shifts.pickupTime));
  }

  /** Get a single shift by ID */
  async getShift(shiftId: string) {
    const rows = await db
      .select()
      .from(shifts)
      .where(eq(shifts.id, shiftId));
    return rows[0] ?? null;
  }

  /** Create an ad-hoc shift (not from a schedule) */
  async createAdHocShift(data: {
    recipientId: string;
    pickupLocationId: string;
    dropoffLocationId: string;
    serviceType: string;
    date: string;
    pickupTime: string;
    estimatedDurationMinutes?: number;
    label?: string;
    pickupNeighborhood?: string;
    dropoffNeighborhood?: string;
    requiresCleanVehicle?: boolean;
    passengerCount?: number;
    carSeatRequired?: boolean;
    notes?: string;
  }) {
    const result = await db
      .insert(shifts)
      .values({
        recipientId: data.recipientId,
        pickupLocationId: data.pickupLocationId,
        dropoffLocationId: data.dropoffLocationId,
        serviceType: data.serviceType ?? 'ride',
        date: data.date,
        pickupTime: data.pickupTime,
        estimatedDurationMinutes: data.estimatedDurationMinutes ?? 60,
        label: data.label ?? null,
        pickupNeighborhood: data.pickupNeighborhood ?? null,
        dropoffNeighborhood: data.dropoffNeighborhood ?? null,
        requiresCleanVehicle: data.requiresCleanVehicle ?? false,
        passengerCount: data.passengerCount ?? 1,
        carSeatRequired: data.carSeatRequired ?? false,
        notes: data.notes ?? null,
        status: 'open',
      })
      .returning();
    return result[0];
  }

  /** Driver claims a shift */
  async claimShift(shiftId: string, driverId: string) {
    const shift = await this.getShift(shiftId);
    if (!shift) return { error: 'Shift not found' };
    if (shift.status !== 'open') return { error: 'Shift is not available for claiming' };

    // Check vehicle status constraint
    if (shift.requiresCleanVehicle) {
      const driverRows = await db
        .select({ vehicleStatus: drivers.vehicleStatus })
        .from(drivers)
        .where(eq(drivers.id, driverId));
      const driver = driverRows[0];
      if (!driver || driver.vehicleStatus !== 'clean') {
        return { error: 'This shift requires a clean vehicle' };
      }
    }

    // Check passenger capacity
    if (shift.passengerCount && shift.passengerCount > 1) {
      const driverRows = await db
        .select({ passengerCapacity: drivers.passengerCapacity })
        .from(drivers)
        .where(eq(drivers.id, driverId));
      const driver = driverRows[0];
      if (driver && driver.passengerCapacity && driver.passengerCapacity < shift.passengerCount) {
        return { error: 'Insufficient passenger capacity' };
      }
    }

    const result = await db
      .update(shifts)
      .set({
        driverId,
        status: 'claimed',
        claimedAt: new Date(),
      })
      .where(and(eq(shifts.id, shiftId), eq(shifts.status, 'open')))
      .returning();

    return result[0] ?? { error: 'Shift was already claimed' };
  }

  /** Coordinator confirms a claimed shift */
  async confirmShift(shiftId: string) {
    const result = await db
      .update(shifts)
      .set({ status: 'confirmed', confirmedAt: new Date() })
      .where(and(eq(shifts.id, shiftId), eq(shifts.status, 'claimed')))
      .returning();
    return result[0] ?? null;
  }

  /** Coordinator rejects a claimed shift — returns to open */
  async rejectClaim(shiftId: string) {
    const result = await db
      .update(shifts)
      .set({ status: 'open', driverId: null, claimedAt: null })
      .where(and(eq(shifts.id, shiftId), eq(shifts.status, 'claimed')))
      .returning();
    return result[0] ?? null;
  }

  /** Driver starts a ride */
  async startShift(shiftId: string) {
    const result = await db
      .update(shifts)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(and(eq(shifts.id, shiftId), eq(shifts.status, 'confirmed')))
      .returning();
    return result[0] ?? null;
  }

  /** Driver completes a ride */
  async completeShift(shiftId: string) {
    const shift = await this.getShift(shiftId);
    if (!shift || shift.status !== 'in_progress') return null;

    const result = await db
      .update(shifts)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(shifts.id, shiftId))
      .returning();

    // Update affinity tracking
    if (shift.driverId) {
      await this.updateAffinity(shift.driverId, shift.recipientId);
    }

    return result[0] ?? null;
  }

  /** Cancel a shift */
  async cancelShift(shiftId: string, reason: string) {
    const result = await db
      .update(shifts)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason,
      })
      .where(eq(shifts.id, shiftId))
      .returning();
    return result[0] ?? null;
  }

  /** Mark no-show */
  async markNoShow(shiftId: string) {
    const result = await db
      .update(shifts)
      .set({ status: 'no_show' })
      .where(eq(shifts.id, shiftId))
      .returning();
    return result[0] ?? null;
  }

  // ========== Shift board (driver view) ==========

  /** Get available shifts for the driver shift board — progressive disclosure */
  async getShiftBoard(driverId: string) {
    const today = new Date().toISOString().split('T')[0];
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + SHIFT_BOARD_HORIZON_DAYS);
    const toDate = horizon.toISOString().split('T')[0];

    // Get driver info for filtering
    const driverRows = await db
      .select({
        vehicleStatus: drivers.vehicleStatus,
        passengerCapacity: drivers.passengerCapacity,
        serviceTypes: drivers.serviceTypes,
        serviceRadius: drivers.serviceRadius,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId));

    const driver = driverRows[0];
    if (!driver) return [];

    // Get open shifts within horizon
    let shiftRows = await db
      .select()
      .from(shifts)
      .where(
        and(
          gte(shifts.date, today),
          lte(shifts.date, toDate),
          eq(shifts.status, 'open'),
        ),
      )
      .orderBy(asc(shifts.date), asc(shifts.pickupTime));

    // Filter: hide clean-only shifts from hot/unknown drivers
    if (driver.vehicleStatus !== 'clean') {
      shiftRows = shiftRows.filter(s => !s.requiresCleanVehicle);
    }

    // Filter by service type opt-in
    const serviceTypes = driver.serviceTypes ?? [];
    shiftRows = shiftRows.filter(s => serviceTypes.includes(s.serviceType ?? 'ride'));

    // Get affinity for preferred pairings
    const recipientIds = [...new Set(shiftRows.map(s => s.recipientId))];
    let affinityMap = new Map<string, { rideCount: number; preferred: boolean }>();

    if (recipientIds.length > 0) {
      const affinities = await db
        .select()
        .from(driverPassengerAffinity)
        .where(
          and(
            eq(driverPassengerAffinity.driverId, driverId),
            inArray(driverPassengerAffinity.recipientId, recipientIds),
          ),
        );
      for (const a of affinities) {
        affinityMap.set(a.recipientId, {
          rideCount: a.rideCount ?? 0,
          preferred: a.preferred ?? false,
        });
      }
    }

    // Get display IDs for recipients
    const recipientDisplayIds = new Map<string, string | null>();
    if (recipientIds.length > 0) {
      const recRows = await db
        .select({ id: recipients.id, displayId: recipients.displayId })
        .from(recipients)
        .where(inArray(recipients.id, recipientIds));
      for (const r of recRows) {
        recipientDisplayIds.set(r.id, r.displayId);
      }
    }

    return shiftRows.map(s => {
      const affinity = affinityMap.get(s.recipientId);
      return {
        id: s.id,
        date: s.date,
        pickupTime: s.pickupTime,
        estimatedDurationMinutes: s.estimatedDurationMinutes,
        serviceType: s.serviceType,
        label: s.label,
        pickupNeighborhood: s.pickupNeighborhood,
        dropoffNeighborhood: s.dropoffNeighborhood,
        recipientDisplayId: recipientDisplayIds.get(s.recipientId) ?? null,
        requiresCleanVehicle: s.requiresCleanVehicle,
        passengerCount: s.passengerCount,
        carSeatRequired: s.carSeatRequired,
        status: s.status,
        priorRideCount: affinity?.rideCount ?? null,
        isPreferredPairing: affinity?.preferred ?? false,
      };
    });
  }

  // ========== Schedules ==========

  /** List all active ride schedules */
  async listSchedules(recipientId?: string) {
    if (recipientId) {
      return db
        .select()
        .from(rideSchedules)
        .where(and(eq(rideSchedules.recipientId, recipientId), eq(rideSchedules.active, true)))
        .orderBy(asc(rideSchedules.pickupTime));
    }
    return db
      .select()
      .from(rideSchedules)
      .where(eq(rideSchedules.active, true))
      .orderBy(asc(rideSchedules.pickupTime));
  }

  /** Create a new ride schedule */
  async createSchedule(data: {
    recipientId: string;
    pickupLocationId: string;
    dropoffLocationId: string;
    daysOfWeek: string[];
    pickupTime: string;
    estimatedDurationMinutes?: number;
    label?: string;
    notes?: string;
    createdBy?: string;
  }) {
    const result = await db
      .insert(rideSchedules)
      .values({
        recipientId: data.recipientId,
        pickupLocationId: data.pickupLocationId,
        dropoffLocationId: data.dropoffLocationId,
        daysOfWeek: data.daysOfWeek,
        pickupTime: data.pickupTime,
        estimatedDurationMinutes: data.estimatedDurationMinutes ?? 60,
        label: data.label ?? null,
        notes: data.notes ?? null,
        createdBy: data.createdBy ?? null,
      })
      .returning();
    return result[0];
  }

  /** Update a ride schedule */
  async updateSchedule(scheduleId: string, data: Partial<{
    daysOfWeek: string[];
    pickupTime: string;
    estimatedDurationMinutes: number;
    label: string;
    notes: string;
    active: boolean;
  }>) {
    const result = await db
      .update(rideSchedules)
      .set(data)
      .where(eq(rideSchedules.id, scheduleId))
      .returning();
    return result[0] ?? null;
  }

  /** Generate shifts from a schedule for a given week */
  async generateShiftsFromSchedule(scheduleId: string, weekStartDate: string) {
    const schedule = await db
      .select()
      .from(rideSchedules)
      .where(eq(rideSchedules.id, scheduleId));

    const sched = schedule[0];
    if (!sched || !sched.active) return [];

    // Get locations for neighborhood info
    const pickupLoc = await db
      .select()
      .from(savedLocations)
      .where(eq(savedLocations.id, sched.pickupLocationId));
    const dropoffLoc = await db
      .select()
      .from(savedLocations)
      .where(eq(savedLocations.id, sched.dropoffLocationId));

    const dayMap: Record<string, number> = {
      mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
    };

    const weekStart = new Date(weekStartDate);
    const created: any[] = [];

    for (const day of sched.daysOfWeek) {
      const dayNum = dayMap[day];
      if (dayNum === undefined) continue;

      const shiftDate = new Date(weekStart);
      const currentDay = shiftDate.getDay();
      const diff = dayNum - currentDay;
      shiftDate.setDate(shiftDate.getDate() + (diff >= 0 ? diff : diff + 7));

      const dateStr = shiftDate.toISOString().split('T')[0];

      // Check if shift already exists for this schedule + date
      const existing = await db
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          and(
            eq(shifts.rideScheduleId, scheduleId),
            eq(shifts.date, dateStr),
          ),
        );

      if (existing.length > 0) continue;

      const result = await db
        .insert(shifts)
        .values({
          rideScheduleId: scheduleId,
          recipientId: sched.recipientId,
          pickupLocationId: sched.pickupLocationId,
          dropoffLocationId: sched.dropoffLocationId,
          serviceType: 'ride',
          date: dateStr,
          pickupTime: sched.pickupTime,
          estimatedDurationMinutes: sched.estimatedDurationMinutes ?? 60,
          label: sched.label,
          pickupNeighborhood: pickupLoc[0]?.neighborhood ?? null,
          dropoffNeighborhood: dropoffLoc[0]?.neighborhood ?? null,
          status: 'open',
        })
        .returning();

      if (result[0]) created.push(result[0]);
    }

    return created;
  }

  // ========== Saved locations ==========

  async listLocations(recipientId: string) {
    return db
      .select({
        id: savedLocations.id,
        recipientId: savedLocations.recipientId,
        label: savedLocations.label,
        address: decryptField(savedLocations.addressEnc, config.DEK),
        lat: savedLocations.lat,
        lng: savedLocations.lng,
        neighborhood: savedLocations.neighborhood,
        isDefault: savedLocations.isDefault,
        createdAt: savedLocations.createdAt,
      })
      .from(savedLocations)
      .where(eq(savedLocations.recipientId, recipientId));
  }

  async createLocation(data: {
    recipientId: string;
    label: string;
    address: string;
    lat?: number;
    lng?: number;
    neighborhood?: string;
    isDefault?: boolean;
  }) {
    const result = await db
      .insert(savedLocations)
      .values({
        recipientId: data.recipientId,
        label: data.label,
        addressEnc: sql`pgp_sym_encrypt(${data.address}, ${config.DEK})`,
        lat: data.lat?.toString() ?? null,
        lng: data.lng?.toString() ?? null,
        neighborhood: data.neighborhood ?? null,
        isDefault: data.isDefault ?? false,
      })
      .returning();
    return result[0];
  }

  // ========== Affinity tracking ==========

  async updateAffinity(driverId: string, recipientId: string) {
    // Upsert: increment ride count and update last ride date
    const existing = await db
      .select()
      .from(driverPassengerAffinity)
      .where(
        and(
          eq(driverPassengerAffinity.driverId, driverId),
          eq(driverPassengerAffinity.recipientId, recipientId),
        ),
      );

    if (existing.length > 0) {
      await db
        .update(driverPassengerAffinity)
        .set({
          rideCount: (existing[0].rideCount ?? 0) + 1,
          lastRideDate: new Date().toISOString().split('T')[0],
        })
        .where(eq(driverPassengerAffinity.id, existing[0].id));
    } else {
      await db.insert(driverPassengerAffinity).values({
        driverId,
        recipientId,
        rideCount: 1,
        lastRideDate: new Date().toISOString().split('T')[0],
      });
    }
  }

  async setPreferredPairing(driverId: string, recipientId: string, preferred: boolean) {
    const existing = await db
      .select()
      .from(driverPassengerAffinity)
      .where(
        and(
          eq(driverPassengerAffinity.driverId, driverId),
          eq(driverPassengerAffinity.recipientId, recipientId),
        ),
      );

    if (existing.length > 0) {
      await db
        .update(driverPassengerAffinity)
        .set({ preferred })
        .where(eq(driverPassengerAffinity.id, existing[0].id));
    } else {
      await db.insert(driverPassengerAffinity).values({
        driverId,
        recipientId,
        preferred,
      });
    }
  }

  async getAffinities(recipientId: string) {
    return db
      .select()
      .from(driverPassengerAffinity)
      .where(eq(driverPassengerAffinity.recipientId, recipientId))
      .orderBy(desc(driverPassengerAffinity.rideCount));
  }

  // ========== Intake requests ==========

  async listIntakeRequests(status?: string) {
    if (status) {
      return db
        .select()
        .from(intakeRequests)
        .where(eq(intakeRequests.status, status))
        .orderBy(desc(intakeRequests.createdAt));
    }
    return db
      .select()
      .from(intakeRequests)
      .orderBy(desc(intakeRequests.createdAt));
  }

  async createIntakeRequest(data: {
    source: string;
    sourceIdentifier?: string;
    rawText?: string;
    parsedData?: Record<string, unknown>;
  }) {
    const result = await db
      .insert(intakeRequests)
      .values({
        source: data.source,
        sourceIdentifier: data.sourceIdentifier ?? null,
        rawText: data.rawText ?? null,
        parsedData: data.parsedData ?? null,
      })
      .returning();
    return result[0];
  }

  async processIntakeRequest(requestId: string, adminId: string, data: {
    linkedRecipientId?: string;
    linkedRideScheduleId?: string;
    rejectionReason?: string;
    status: 'processed' | 'rejected';
  }) {
    const result = await db
      .update(intakeRequests)
      .set({
        status: data.status,
        processedBy: adminId,
        processedAt: new Date(),
        linkedRecipientId: data.linkedRecipientId ?? null,
        linkedRideScheduleId: data.linkedRideScheduleId ?? null,
        rejectionReason: data.rejectionReason ?? null,
      })
      .where(eq(intakeRequests.id, requestId))
      .returning();
    return result[0] ?? null;
  }

  // ========== Dashboard stats ==========

  async getRideStats() {
    const today = new Date().toISOString().split('T')[0];

    const todaysShifts = await db
      .select()
      .from(shifts)
      .where(eq(shifts.date, today));

    const pendingIntake = await db
      .select({ id: intakeRequests.id })
      .from(intakeRequests)
      .where(eq(intakeRequests.status, 'pending'));

    const activeSchedules = await db
      .select({ id: rideSchedules.id })
      .from(rideSchedules)
      .where(eq(rideSchedules.active, true));

    return {
      todaysRides: todaysShifts.length,
      openShifts: todaysShifts.filter(s => s.status === 'open').length,
      claimedShifts: todaysShifts.filter(s => s.status === 'claimed').length,
      confirmedShifts: todaysShifts.filter(s => s.status === 'confirmed').length,
      inProgressShifts: todaysShifts.filter(s => s.status === 'in_progress').length,
      completedToday: todaysShifts.filter(s => s.status === 'completed').length,
      pendingIntake: pendingIntake.length,
      activeSchedules: activeSchedules.length,
    };
  }
}

export const rideService = new RideService();
