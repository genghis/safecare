import { eq, sql, type SQL } from 'drizzle-orm';
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

interface DriverRecord extends Record<string, unknown> {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  vettedStatus: VettedStatus | null;
  vehicleSize: VehicleSize | null;
  vehicleModel: string | null;
  maxDeliveries: number | null;
  languages: string[] | null;
  availability: AvailabilitySlot[] | string | null;
  deliveryZoneIds: string[] | null;
  teamName: string | null;
  createdAt: Date | null;
}

function driverSelectQuery(whereClause?: SQL) {
  return sql<DriverRecord>`
    SELECT
      id,
      pgp_sym_decrypt(name_enc::bytea, ${config.DEK}) AS name,
      pgp_sym_decrypt(phone_enc::bytea, ${config.DEK}) AS phone,
      CASE
        WHEN email_enc IS NULL THEN NULL
        ELSE pgp_sym_decrypt(email_enc::bytea, ${config.DEK})
      END AS email,
      vetted_status AS "vettedStatus",
      vehicle_size AS "vehicleSize",
      vehicle_model AS "vehicleModel",
      max_deliveries AS "maxDeliveries",
      languages,
      availability,
      delivery_zone_ids AS "deliveryZoneIds",
      team_name AS "teamName",
      created_at AS "createdAt"
    FROM drivers
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
  `;
}

function normalizeDriverRow(row: DriverRecord): DriverRecord {
  const availability =
    typeof row.availability === 'string'
      ? JSON.parse(row.availability) as AvailabilitySlot[]
      : (row.availability ?? []);

  return {
    ...row,
    languages: row.languages ?? [],
    availability,
    deliveryZoneIds: row.deliveryZoneIds ?? [],
  };
}

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
        maxDeliveries: data.maxDeliveries ?? 3,
        languages: data.languages,
        availability: JSON.stringify(data.availability ?? []),
        deliveryZoneIds: data.deliveryZoneIds ?? [],
        teamName: data.teamName,
      } as any)
      .returning({ id: drivers.id });

    return result[0].id;
  }

  async findById(id: string) {
    const rows = await db.execute<DriverRecord>(driverSelectQuery(sql`id = ${id}`));
    return rows[0] ? normalizeDriverRow(rows[0]) : null;
  }

  async findByPhone(phone: string) {
    const rows = await db.execute<DriverRecord>(
      driverSelectQuery(
        sql`phone_hash = encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
      ),
    );

    return rows[0] ? normalizeDriverRow(rows[0]) : null;
  }

  async list() {
    const rows = await db.execute<DriverRecord>(driverSelectQuery());
    return rows.map(normalizeDriverRow);
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
