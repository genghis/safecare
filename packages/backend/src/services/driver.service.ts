import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { drivers } from '../db/schema.js';
import { config } from '../config.js';
import type { VettedStatus } from '@safecare/shared';

export interface CreateDriverInput {
  name: string;
  phone: string;
  email?: string;
  vehicleModel?: string;
  cargoCapacity?: number;
  languages?: string[];
  geoPreferences?: string;
  timeConstraints?: string;
  teamName?: string;
}

export class DriverService {
  /**
   * Create a new driver with encrypted PII.
   */
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
        vehicleModel: data.vehicleModel,
        cargoCapacity: data.cargoCapacity,
        languages: data.languages,
        geoPreferences: data.geoPreferences,
        timeConstraints: data.timeConstraints,
        teamName: data.teamName,
      } as any)
      .returning({ id: drivers.id });

    return result[0].id;
  }

  /**
   * Find a driver by id, decrypting PII.
   */
  async findById(id: string) {
    const rows = await db
      .select({
        id: drivers.id,
        name: sql<string>`pgp_sym_decrypt(${drivers.nameEnc}::bytea, ${config.DEK})`,
        phone: sql<string>`pgp_sym_decrypt(${drivers.phoneEnc}::bytea, ${config.DEK})`,
        email: sql<string>`pgp_sym_decrypt(${drivers.emailEnc}::bytea, ${config.DEK})`,
        vettedStatus: drivers.vettedStatus,
        vehicleModel: drivers.vehicleModel,
        cargoCapacity: drivers.cargoCapacity,
        languages: drivers.languages,
        geoPreferences: drivers.geoPreferences,
        timeConstraints: drivers.timeConstraints,
        teamName: drivers.teamName,
        createdAt: drivers.createdAt,
      })
      .from(drivers)
      .where(eq(drivers.id, id));

    return rows[0] ?? null;
  }

  /**
   * Find a driver by phone using HMAC hash lookup.
   */
  async findByPhone(phone: string) {
    const rows = await db
      .select({
        id: drivers.id,
        name: sql<string>`pgp_sym_decrypt(${drivers.nameEnc}::bytea, ${config.DEK})`,
        phone: sql<string>`pgp_sym_decrypt(${drivers.phoneEnc}::bytea, ${config.DEK})`,
        email: sql<string>`pgp_sym_decrypt(${drivers.emailEnc}::bytea, ${config.DEK})`,
        vettedStatus: drivers.vettedStatus,
        vehicleModel: drivers.vehicleModel,
        cargoCapacity: drivers.cargoCapacity,
        languages: drivers.languages,
        geoPreferences: drivers.geoPreferences,
        timeConstraints: drivers.timeConstraints,
        teamName: drivers.teamName,
        createdAt: drivers.createdAt,
      })
      .from(drivers)
      .where(
        eq(
          drivers.phoneHash,
          sql`encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        ),
      );

    return rows[0] ?? null;
  }

  /**
   * List all drivers, decrypting names and phones.
   */
  async list() {
    return db
      .select({
        id: drivers.id,
        name: sql<string>`pgp_sym_decrypt(${drivers.nameEnc}::bytea, ${config.DEK})`,
        phone: sql<string>`pgp_sym_decrypt(${drivers.phoneEnc}::bytea, ${config.DEK})`,
        vettedStatus: drivers.vettedStatus,
        vehicleModel: drivers.vehicleModel,
        cargoCapacity: drivers.cargoCapacity,
        languages: drivers.languages,
        teamName: drivers.teamName,
        createdAt: drivers.createdAt,
      })
      .from(drivers);
  }

  /**
   * Update a driver's vetted status.
   */
  async updateVettedStatus(id: string, status: VettedStatus) {
    const result = await db
      .update(drivers)
      .set({ vettedStatus: status })
      .where(eq(drivers.id, id))
      .returning({ id: drivers.id });

    return result[0] ?? null;
  }
}

export const driverService = new DriverService();
