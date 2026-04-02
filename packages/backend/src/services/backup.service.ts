import crypto from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import Redis from 'ioredis';
import { asc, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { SAFECARE_VERSION } from '@safecare/shared';
import { config } from '../config.js';
import { db, client } from '../db/index.js';
import {
  adminUsers,
  auditLog,
  communicationSessions,
  deliveryZones,
  deliveries,
  dispatchSessions,
  downloadTokens,
  drivers,
  driverCheckIns,
  recipients,
} from '../db/schema.js';
import { recipientService } from './recipient.service.js';
import { driverService } from './driver.service.js';

const redis = new Redis(config.REDIS_URL);
const SETTINGS_KEY = 'org:settings';

export interface BackupSummary {
  orgName: string;
  adminCount: number;
  recipientCount: number;
  driverCount: number;
  zoneCount: number;
  dispatchSessionCount: number;
  deliveryCount: number;
  checkInCount: number;
  includesMapData: boolean;
}

export interface BackupPayload {
  format: 'safecare-backup-data';
  version: 1;
  safeCareVersion: string;
  exportedAt: string;
  summary: BackupSummary;
  data: {
    settings: unknown;
    admins: unknown[];
    recipients: unknown[];
    drivers: unknown[];
    zones: unknown[];
    dispatchSessions: unknown[];
    deliveries: unknown[];
    driverCheckIns: unknown[];
  };
}

export interface BackupEnvelope {
  format: 'safecare-backup';
  version: 1;
  safeCareVersion: string;
  createdAt: string;
  compression: 'gzip';
  encryption: 'aes-256-gcm';
  kdf: {
    name: 'scrypt';
    salt: string;
    keyLength: number;
    N?: number;
    r?: number;
    p?: number;
  };
  iv: string;
  authTag: string;
  ciphertext: string;
  summary: BackupSummary;
}

export interface BackupExportResult {
  buffer: Buffer;
  filename: string;
  summary: BackupSummary;
}

export interface BackupImportResult {
  summary: BackupSummary;
  requiresMapProvisioning: boolean;
}

interface BackupDependencies {
  loadSettings: () => Promise<unknown>;
  loadAdmins: () => Promise<unknown[]>;
  loadRecipients: () => Promise<unknown[]>;
  loadDrivers: () => Promise<unknown[]>;
  loadZones: () => Promise<unknown[]>;
  loadDispatchSessions: () => Promise<unknown[]>;
  loadDeliveries: () => Promise<unknown[]>;
  loadDriverCheckIns: () => Promise<unknown[]>;
  persistImportedBackup: (payload: BackupPayload) => Promise<void>;
}

interface DeliveryExportRow extends Record<string, unknown> {
  id: string;
  recipientId: string | null;
  driverId: string | null;
  dispatchSessionId: string | null;
  status: string | null;
  address: string | null;
  lat: string | null;
  lng: string | null;
  notes: string | null;
  releasedAt: Date | null;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date | null;
}

const defaultDependencies: BackupDependencies = {
  async loadSettings() {
    const raw = await redis.get(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  async loadAdmins() {
    return db
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        passwordHash: adminUsers.passwordHash,
        role: adminUsers.role,
        totpSecret: adminUsers.totpSecret,
        totpBackupCodes: adminUsers.totpBackupCodes,
        createdAt: adminUsers.createdAt,
      })
      .from(adminUsers)
      .orderBy(asc(adminUsers.createdAt));
  },

  async loadRecipients() {
    return recipientService.list();
  },

  async loadDrivers() {
    return driverService.list();
  },

  async loadZones() {
    return db.select().from(deliveryZones).orderBy(asc(deliveryZones.createdAt));
  },

  async loadDispatchSessions() {
    return db.select().from(dispatchSessions).orderBy(asc(dispatchSessions.createdAt));
  },

  async loadDeliveries() {
    return db.execute<DeliveryExportRow>(sql`
      SELECT
        id,
        recipient_id AS "recipientId",
        driver_id AS "driverId",
        dispatch_session_id AS "dispatchSessionId",
        status,
        CASE
          WHEN address_enc IS NULL THEN NULL
          ELSE pgp_sym_decrypt(address_enc::bytea, ${config.DEK})
        END AS address,
        lat,
        lng,
        notes,
        released_at AS "releasedAt",
        delivered_at AS "deliveredAt",
        acknowledged_at AS "acknowledgedAt",
        created_at AS "createdAt"
      FROM deliveries
      ORDER BY created_at ASC
    `);
  },

  async loadDriverCheckIns() {
    return db.select().from(driverCheckIns).orderBy(asc(driverCheckIns.checkedInAt));
  },

  async persistImportedBackup(payload: BackupPayload) {
    await client.begin(async (transactionClient) => {
      const transaction = transactionClient as any;
      const tx = drizzle(transaction as any, {
        schema: {
          adminUsers,
          auditLog,
          communicationSessions,
          deliveryZones,
          deliveries,
          dispatchSessions,
          downloadTokens,
          drivers,
          driverCheckIns,
          recipients,
        },
      });

      await transaction`
        TRUNCATE TABLE
          driver_check_ins,
          download_tokens,
          communication_sessions,
          deliveries,
          dispatch_sessions,
          drivers,
          recipients,
          delivery_zones,
          admin_users,
          audit_log
        RESTART IDENTITY CASCADE
      `;

      const { data } = payload;

      if (data.admins.length > 0) {
        await tx.insert(adminUsers).values(
          data.admins.map((admin) => {
            const value = admin as Record<string, unknown>;
            return {
              id: String(value.id),
              email: String(value.email),
              passwordHash: String(value.passwordHash),
              role: typeof value.role === 'string' ? value.role : 'admin',
              totpSecret: typeof value.totpSecret === 'string' ? value.totpSecret : null,
              totpBackupCodes: Array.isArray(value.totpBackupCodes)
                ? value.totpBackupCodes.map(String)
                : [],
              createdAt: toDateOrNull(value.createdAt),
            };
          }),
        );
      }

      if (data.recipients.length > 0) {
        await tx.insert(recipients).values(
          data.recipients.map((recipient) => {
            const value = recipient as Record<string, unknown>;
            const name = String(value.name ?? '');
            const address = String(value.address ?? '');
            const phone = String(value.phone ?? '');
            return {
              id: String(value.id),
              nameEnc: sql`pgp_sym_encrypt(${name}, ${config.DEK})`,
              nameHash: sql`encode(hmac(${name}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
              addressEnc: sql`pgp_sym_encrypt(${address}, ${config.DEK})`,
              phoneEnc: sql`pgp_sym_encrypt(${phone}, ${config.DEK})`,
              phoneHash: sql`encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
              lat: toNumericString(value.lat),
              lng: toNumericString(value.lng),
              communicationPreference:
                typeof value.communicationPreference === 'string'
                  ? value.communicationPreference
                  : 'sms',
              whatsappConsent: Boolean(value.whatsappConsent),
              language: typeof value.language === 'string' ? value.language : 'en',
              verified: Boolean(value.verified),
              createdAt: toDateOrNull(value.createdAt),
            } as any;
          }),
        );
      }

      if (data.drivers.length > 0) {
        await tx.insert(drivers).values(
          data.drivers.map((driver) => {
            const value = driver as Record<string, unknown>;
            const name = String(value.name ?? '');
            const phone = String(value.phone ?? '');
            const email = typeof value.email === 'string' ? value.email : null;
            return {
              id: String(value.id),
              nameEnc: sql`pgp_sym_encrypt(${name}, ${config.DEK})`,
              nameHash: sql`encode(hmac(${name}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
              phoneEnc: sql`pgp_sym_encrypt(${phone}, ${config.DEK})`,
              phoneHash: sql`encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
              emailEnc: email ? sql`pgp_sym_encrypt(${email}, ${config.DEK})` : null,
              vettedStatus:
                typeof value.vettedStatus === 'string' ? value.vettedStatus : 'pending',
              vehicleSize:
                typeof value.vehicleSize === 'string' ? value.vehicleSize : 'sedan',
              vehicleModel:
                typeof value.vehicleModel === 'string' ? value.vehicleModel : null,
              maxDeliveries:
                typeof value.maxDeliveries === 'number'
                  ? value.maxDeliveries
                  : typeof value.maxDeliveries === 'string'
                    ? parseInt(value.maxDeliveries, 10)
                    : 3,
              languages: Array.isArray(value.languages)
                ? value.languages.map(String)
                : [],
              availability: JSON.stringify(
                Array.isArray(value.availability) ? value.availability : [],
              ),
              deliveryZoneIds: Array.isArray(value.deliveryZoneIds)
                ? value.deliveryZoneIds.map(String)
                : [],
              teamName: typeof value.teamName === 'string' ? value.teamName : null,
              createdAt: toDateOrNull(value.createdAt),
            } as any;
          }),
        );
      }

      if (data.zones.length > 0) {
        await tx.insert(deliveryZones).values(
          data.zones.map((zone) => {
            const value = zone as Record<string, unknown>;
            return {
              id: String(value.id),
              name: String(value.name ?? ''),
              color: typeof value.color === 'string' ? value.color : '#3B82F6',
              polygon: value.polygon ?? [],
              centerLat: toNumericString(value.centerLat),
              centerLng: toNumericString(value.centerLng),
              active: value.active !== false,
              createdAt: toDateOrNull(value.createdAt),
            } as any;
          }),
        );
      }

      if (data.dispatchSessions.length > 0) {
        await tx.insert(dispatchSessions).values(
          data.dispatchSessions.map((session) => {
            const value = session as Record<string, unknown>;
            return {
              id: String(value.id),
              date: String(value.date),
              status: typeof value.status === 'string' ? value.status : 'draft',
              createdBy:
                typeof value.createdBy === 'string' ? value.createdBy : null,
              strictnessLevel:
                typeof value.strictnessLevel === 'string'
                  ? value.strictnessLevel
                  : 'standard',
              downloadTokenTtlMinutes:
                typeof value.downloadTokenTtlMinutes === 'number'
                  ? value.downloadTokenTtlMinutes
                  : typeof value.downloadTokenTtlMinutes === 'string'
                    ? parseInt(value.downloadTokenTtlMinutes, 10)
                    : 5,
              routeDataTtlHours:
                typeof value.routeDataTtlHours === 'number'
                  ? value.routeDataTtlHours
                  : typeof value.routeDataTtlHours === 'string'
                    ? parseInt(value.routeDataTtlHours, 10)
                    : 8,
              createdAt: toDateOrNull(value.createdAt),
            } as any;
          }),
        );
      }

      if (data.deliveries.length > 0) {
        await tx.insert(deliveries).values(
          data.deliveries.map((delivery) => {
            const value = delivery as Record<string, unknown>;
            const address =
              typeof value.address === 'string' && value.address.length > 0
                ? value.address
                : null;
            return {
              id: String(value.id),
              recipientId:
                typeof value.recipientId === 'string' ? value.recipientId : null,
              driverId: typeof value.driverId === 'string' ? value.driverId : null,
              dispatchSessionId:
                typeof value.dispatchSessionId === 'string'
                  ? value.dispatchSessionId
                  : null,
              status: typeof value.status === 'string' ? value.status : 'pending',
              addressEnc: address
                ? sql`pgp_sym_encrypt(${address}, ${config.DEK})`
                : null,
              lat: toNumericString(value.lat),
              lng: toNumericString(value.lng),
              notes: typeof value.notes === 'string' ? value.notes : null,
              releasedAt: toDateOrNull(value.releasedAt),
              deliveredAt: toDateOrNull(value.deliveredAt),
              acknowledgedAt: toDateOrNull(value.acknowledgedAt),
              createdAt: toDateOrNull(value.createdAt),
            } as any;
          }),
        );
      }

      if (data.driverCheckIns.length > 0) {
        await tx.insert(driverCheckIns).values(
          data.driverCheckIns.map((checkIn) => {
            const value = checkIn as Record<string, unknown>;
            return {
              id: String(value.id),
              driverId: String(value.driverId),
              dispatchSessionId: String(value.dispatchSessionId),
              checkedInAt: toDateOrNull(value.checkedInAt),
              routeReleasedAt: toDateOrNull(value.routeReleasedAt),
              routeDownloadedAt: toDateOrNull(value.routeDownloadedAt),
              purgeConfirmedAt: toDateOrNull(value.purgeConfirmedAt),
            } as any;
          }),
        );
      }
    });

    const settings = payload.data.settings ?? null;
    if (settings) {
      await redis.set(SETTINGS_KEY, JSON.stringify(settings));
    } else {
      await redis.del(SETTINGS_KEY);
    }

    await redis.del('map:provision:status', 'map:tile:status');
  },
};

function buildSummary(
  settings: unknown,
  admins: unknown[],
  recipients: unknown[],
  drivers: unknown[],
  zones: unknown[],
  sessions: unknown[],
  deliveries: unknown[],
  checkIns: unknown[],
): BackupSummary {
  const orgName =
    typeof settings === 'object' &&
    settings !== null &&
    'orgName' in settings &&
    typeof (settings as { orgName?: unknown }).orgName === 'string'
      ? (settings as { orgName: string }).orgName
      : '';

  return {
    orgName,
    adminCount: admins.length,
    recipientCount: recipients.length,
    driverCount: drivers.length,
    zoneCount: zones.length,
    dispatchSessionCount: sessions.length,
    deliveryCount: deliveries.length,
    checkInCount: checkIns.length,
    includesMapData: false,
  };
}

/** scrypt cost parameters — OWASP minimum is N=32768; we use 32768 for offline backup protection.
 *  N=32768, r=8 requires ~32 MB which stays within Node.js default maxmem. */
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(passphrase: string, salt: Buffer, keyLength: number): Buffer {
  return crypto.scryptSync(passphrase, salt, keyLength, SCRYPT_PARAMS);
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumericString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function formatFilename(exportedAt: string): string {
  const date = new Date(exportedAt);
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ];
  const time = [
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ];
  return `safecare-backup-${parts.join('')}-${time.join('')}.scbackup`;
}

export class BackupService {
  private readonly deps: BackupDependencies;

  constructor(deps: Partial<BackupDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...deps };
  }

  async buildPayload(): Promise<BackupPayload> {
    const [
      settings,
      admins,
      recipients,
      drivers,
      zones,
      sessions,
      deliveries,
      checkIns,
    ] = await Promise.all([
      this.deps.loadSettings(),
      this.deps.loadAdmins(),
      this.deps.loadRecipients(),
      this.deps.loadDrivers(),
      this.deps.loadZones(),
      this.deps.loadDispatchSessions(),
      this.deps.loadDeliveries(),
      this.deps.loadDriverCheckIns(),
    ]);

    const exportedAt = new Date().toISOString();
    const summary = buildSummary(
      settings,
      admins,
      recipients,
      drivers,
      zones,
      sessions,
      deliveries,
      checkIns,
    );

    return {
      format: 'safecare-backup-data',
      version: 1,
      safeCareVersion: SAFECARE_VERSION,
      exportedAt,
      summary,
      data: {
        settings,
        admins,
        recipients,
        drivers,
        zones,
        dispatchSessions: sessions,
        deliveries,
        driverCheckIns: checkIns,
      },
    };
  }

  async createEncryptedBackup(passphrase: string): Promise<BackupExportResult> {
    const payload = await this.buildPayload();
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const compressed = gzipSync(plaintext);
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const keyLength = 32;
    const key = deriveKey(passphrase, salt, keyLength);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const envelope: BackupEnvelope = {
      format: 'safecare-backup',
      version: 1,
      safeCareVersion: SAFECARE_VERSION,
      createdAt: payload.exportedAt,
      compression: 'gzip',
      encryption: 'aes-256-gcm',
      kdf: {
        name: 'scrypt',
        salt: salt.toString('base64'),
        keyLength,
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
      },
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      summary: payload.summary,
    };

    return {
      buffer: Buffer.from(JSON.stringify(envelope, null, 2), 'utf8'),
      filename: formatFilename(payload.exportedAt),
      summary: payload.summary,
    };
  }

  decryptBackupFile(input: Buffer | string, passphrase: string): BackupPayload {
    const parsed = JSON.parse(
      typeof input === 'string' ? input : input.toString('utf8'),
    ) as BackupEnvelope;

    const salt = Buffer.from(parsed.kdf.salt, 'base64');
    // Read scrypt params from envelope (with fallback for old backups without them)
    const kdfParams = parsed.kdf as { N?: number; r?: number; p?: number };
    const scryptOpts = {
      N: kdfParams.N ?? SCRYPT_PARAMS.N,
      r: kdfParams.r ?? SCRYPT_PARAMS.r,
      p: kdfParams.p ?? SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    };
    const key = crypto.scryptSync(passphrase, salt, parsed.kdf.keyLength, scryptOpts);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parsed.iv, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));

    const compressed = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
      decipher.final(),
    ]);

    const payload = JSON.parse(gunzipSync(compressed).toString('utf8')) as BackupPayload;
    this.validatePayload(payload);
    return payload;
  }

  async importEncryptedBackup(
    input: Buffer | string,
    passphrase: string,
  ): Promise<BackupImportResult> {
    const payload = this.decryptBackupFile(input, passphrase);
    await this.deps.persistImportedBackup(payload);
    return {
      summary: payload.summary,
      requiresMapProvisioning: true,
    };
  }

  private validatePayload(payload: BackupPayload): void {
    if (payload.format !== 'safecare-backup-data' || payload.version !== 1) {
      throw new Error('Unsupported backup format');
    }
    if (!payload.data || typeof payload.data !== 'object') {
      throw new Error('Backup payload is missing data');
    }
    if (!Array.isArray(payload.data.admins)) {
      throw new Error('Backup payload is invalid');
    }
  }
}

export const backupService = new BackupService();
