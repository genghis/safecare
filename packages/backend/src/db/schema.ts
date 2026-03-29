import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  date,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------- recipients ----------
export const recipients = pgTable('recipients', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  nameEnc: text('name_enc').notNull(),
  nameHash: text('name_hash').notNull(),
  addressEnc: text('address_enc').notNull(),
  phoneEnc: text('phone_enc').notNull(),
  phoneHash: text('phone_hash').notNull().unique(),
  lat: numeric('lat'),
  lng: numeric('lng'),
  communicationPreference: text('communication_preference').default('sms'),
  whatsappConsent: boolean('whatsapp_consent').default(false),
  language: text('language').default('en'),
  verified: boolean('verified').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- delivery_zones (admin-defined areas drivers can pick from) ----------
export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  color: text('color').default('#3B82F6'),
  polygon: jsonb('polygon').notNull(), // Array<{lat, lng}>
  centerLat: numeric('center_lat'),
  centerLng: numeric('center_lng'),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- drivers ----------
export const drivers = pgTable('drivers', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  nameEnc: text('name_enc').notNull(),
  nameHash: text('name_hash'),
  phoneEnc: text('phone_enc').notNull(),
  phoneHash: text('phone_hash').notNull().unique(),
  emailEnc: text('email_enc'),
  vettedStatus: text('vetted_status').default('pending'),
  vehicleSize: text('vehicle_size').default('sedan'),
  vehicleModel: text('vehicle_model'),
  maxDeliveries: integer('max_deliveries').default(3),
  languages: text('languages').array(),
  availability: jsonb('availability').default([]),  // AvailabilitySlot[]
  deliveryZoneIds: text('delivery_zone_ids').array().default([]),
  teamName: text('team_name'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- admin_users ----------
export const adminUsers = pgTable('admin_users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').default('admin'),
  totpSecret: text('totp_secret'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- dispatch_sessions ----------
export const dispatchSessions = pgTable('dispatch_sessions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  date: date('date').notNull(),
  status: text('status').default('draft'),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  strictnessLevel: text('strictness_level').default('standard'),
  downloadTokenTtlMinutes: integer('download_token_ttl_minutes').default(5),
  routeDataTtlHours: integer('route_data_ttl_hours').default(8),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- deliveries ----------
export const deliveries = pgTable('deliveries', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  recipientId: uuid('recipient_id').references(() => recipients.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  dispatchSessionId: uuid('dispatch_session_id').references(
    () => dispatchSessions.id,
  ),
  status: text('status').default('pending'),
  addressEnc: text('address_enc'),
  lat: numeric('lat'),
  lng: numeric('lng'),
  notes: text('notes'),
  releasedAt: timestamp('released_at'),
  deliveredAt: timestamp('delivered_at'),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- driver_check_ins ----------
export const driverCheckIns = pgTable('driver_check_ins', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  driverId: uuid('driver_id')
    .references(() => drivers.id)
    .notNull(),
  dispatchSessionId: uuid('dispatch_session_id')
    .references(() => dispatchSessions.id)
    .notNull(),
  checkedInAt: timestamp('checked_in_at').defaultNow(),
  routeReleasedAt: timestamp('route_released_at'),
  routeDownloadedAt: timestamp('route_downloaded_at'),
  purgeConfirmedAt: timestamp('purge_confirmed_at'),
});

// ---------- communication_sessions ----------
export const communicationSessions = pgTable('communication_sessions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  driverPhoneEnc: text('driver_phone_enc'),
  recipientPhoneEnc: text('recipient_phone_enc'),
  twilioProxyNumber: text('twilio_proxy_number'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- download_tokens ----------
export const downloadTokens = pgTable('download_tokens', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  driverId: uuid('driver_id')
    .references(() => drivers.id)
    .notNull(),
  dispatchSessionId: uuid('dispatch_session_id')
    .references(() => dispatchSessions.id)
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  used: boolean('used').default(false),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- audit_log ----------
export const auditLog = pgTable('audit_log', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  driverId: uuid('driver_id'),
  action: text('action').notNull(),
  stopCount: integer('stop_count'),
  completedCount: integer('completed_count'),
  releasedAt: timestamp('released_at'),
  purgedAt: timestamp('purged_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
