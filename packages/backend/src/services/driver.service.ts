import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { drivers } from '../db/schema.js';
import { config } from '../config.js';
import type { VettedStatus, VehicleSize, AvailabilitySlot } from '@safecare/shared';

export interface CreateDriverInput {
  name: string;
  phone: string;
  email?: string;
  vehicleSize?: VehicleSize;
  vehicleModel?: string;
  maxDeliveries?: number;
  languages?: string[];
  availability?: AvailabilitySlot[];
  deliveryZoneIds?: string[];
  teamName?: string;
}

export interface UpdateDriverProfileInput {
  vehicleSize?: VehicleSize;
  vehicleModel?: string;
  maxDeliveries?: number;
  languages?: string[];
  availability?: AvailabilitySlot[];
  deliveryZoneIds?: string[];
}

const driverSelectFields = {
  id: drivers.id,
  name: sql<string>`pgp_sym_decrypt(${drivers.nameEnc}::bytea, ${config.DEK})`,
  phone: sql<string>`pgp_sym_decrypt(${drivers.phoneEnc}::bytea, ${config.DEK})`,
  email: sql<string>`pgp_sym_decrypt(${drivers.emailEnc}::bytea, ${config.DEK})`,
  vettedStatus: drivers.vettedStatus,
  vehicleSize: drivers.vehicleSize,
  vehicleModel: drivers.vehicleModel,
  maxDeliveries: drivers.maxDeliveries,
  languages: drivers.languages,
  availability: drivers.availability,
  deliveryZoneIds: drivers.deliveryZoneIds,
  teamName: drivers.teamName,
  createdAt: drivers.createdAt,
};

export class DriverService {
  async create(data: CreateDriverInput): Promise<string> {
    const result = await db
      .insert(drivers)
      .values({
        nameEnc: sql`pgp_sym_encrypt(${data.name}, ${config.DEK})`,
        nameHash: sql`encode(hmac(${data.name}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        phoneEnc: sql`pgp_sym_encrypt(${data.phone}, ${config.DEK})`,
        phoneHash: sql`encode(hmac(${data.phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        emailEnc: data.email
          ? sql`pgp_sym_encrypt(${data.email}, ${config.DEK})`
          : null,
        vehicleSize: data.vehicleSize ?? 'sedan',
        vehicleModel: data.vehicleModel,
        maxDeliveries: data.maxDeliveries ?? 5,
        languages: data.languages,
        availability: JSON.stringify(data.availability ?? []),
        deliveryZoneIds: data.deliveryZoneIds ?? [],
        teamName: data.teamName,
      } as any)
      .returning({ id: drivers.id });

    return result[0].id;
  }

  async findById(id: string) {
    const rows = await db
      .select(driverSelectFields)
      .from(drivers)
      .where(eq(drivers.id, id));

    return rows[0] ?? null;
  }

  async findByPhone(phone: string) {
    const rows = await db
      .select(driverSelectFields)
      .from(drivers)
      .where(
        eq(
          drivers.phoneHash,
          sql`encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        ),
      );

    return rows[0] ?? null;
  }

  async list() {
    return db
      .select(driverSelectFields)
      .from(drivers);
  }

  async listAvailableForDay(day: string) {
    const allDrivers = await this.list();
    return allDrivers.filter((d) => {
      if (d.vettedStatus !== 'vetted') return false;
      const slots = (d.availability ?? []) as AvailabilitySlot[];
      return slots.some((s) => s.day === day);
    });
  }

  async updateVettedStatus(id: string, status: VettedStatus) {
    const result = await db
      .update(drivers)
      .set({ vettedStatus: status })
      .where(eq(drivers.id, id))
      .returning({ id: drivers.id });

    return result[0] ?? null;
  }

  async updateProfile(id: string, data: UpdateDriverProfileInput) {
    const updates: Record<string, any> = {};
    if (data.vehicleSize !== undefined) updates.vehicleSize = data.vehicleSize;
    if (data.vehicleModel !== undefined) updates.vehicleModel = data.vehicleModel;
    if (data.maxDeliveries !== undefined) updates.maxDeliveries = data.maxDeliveries;
    if (data.languages !== undefined) updates.languages = data.languages;
    if (data.availability !== undefined) updates.availability = JSON.stringify(data.availability);
    if (data.deliveryZoneIds !== undefined) updates.deliveryZoneIds = data.deliveryZoneIds;

    if (Object.keys(updates).length === 0) return null;

    const result = await db
      .update(drivers)
      .set(updates)
      .where(eq(drivers.id, id))
      .returning({ id: drivers.id });

    return result[0] ?? null;
  }
}

export const driverService = new DriverService();
