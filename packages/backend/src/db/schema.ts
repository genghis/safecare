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
  time,
  uniqueIndex,
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
  displayId: text('display_id'),                           // "P2", "P3" — short ID for shift board
  serviceTypes: text('service_types').array().default(['delivery']),
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
  vehicleDescriptionEnc: text('vehicle_description_enc'),  // encrypted: "red ford focus"
  maxDeliveries: integer('max_deliveries').default(3),
  maxRidesPerWeek: integer('max_rides_per_week').default(10),
  vehicleStatus: text('vehicle_status').default('unknown'),        // clean | flagged | unknown
  passengerCapacity: integer('passenger_capacity').default(4),     // seats excluding driver
  insuranceVerified: boolean('insurance_verified').default(false),
  insuranceNotes: text('insurance_notes'),
  serviceRadius: text('service_radius').default('neighborhood'),   // neighborhood | metro | regional
  serviceTypes: text('service_types').array().default(['delivery']),
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
  totpBackupCodes: text('totp_backup_codes').array().default([]),
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
  adminId: uuid('admin_id'),
  action: text('action').notNull(),
  ip: text('ip'),
  details: jsonb('details'),
  stopCount: integer('stop_count'),
  completedCount: integer('completed_count'),
  releasedAt: timestamp('released_at'),
  purgedAt: timestamp('purged_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- saved_locations ----------
// Multiple named addresses per recipient/passenger ("home", "work 1", "work 2")
export const savedLocations = pgTable('saved_locations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  recipientId: uuid('recipient_id')
    .references(() => recipients.id, { onDelete: 'cascade' })
    .notNull(),
  label: text('label').notNull(),              // "home", "work 1", "school"
  addressEnc: text('address_enc').notNull(),   // pgp_sym_encrypt(address, DEK)
  lat: numeric('lat'),
  lng: numeric('lng'),
  neighborhood: text('neighborhood'),          // coarse area for shift board display
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- ride_schedules ----------
// Recurring ride templates: "P2: work 1 → home, Mon/Wed/Fri at 13:30"
export const rideSchedules = pgTable('ride_schedules', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  recipientId: uuid('recipient_id')
    .references(() => recipients.id, { onDelete: 'cascade' })
    .notNull(),
  pickupLocationId: uuid('pickup_location_id')
    .references(() => savedLocations.id)
    .notNull(),
  dropoffLocationId: uuid('dropoff_location_id')
    .references(() => savedLocations.id)
    .notNull(),
  daysOfWeek: text('days_of_week').array().notNull(),  // ['mon','wed','fri']
  pickupTime: time('pickup_time').notNull(),            // '13:30'
  estimatedDurationMinutes: integer('estimated_duration_minutes').default(60),
  label: text('label'),                                 // "work 1 to home"
  notes: text('notes'),
  active: boolean('active').default(true),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- shifts ----------
// Individual ride instances — the ride equivalent of deliveries.
// Uses driver-claim model instead of coordinator-push assignment.
export const shifts = pgTable('shifts', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  rideScheduleId: uuid('ride_schedule_id').references(() => rideSchedules.id),
  recipientId: uuid('recipient_id')
    .references(() => recipients.id)
    .notNull(),
  driverId: uuid('driver_id').references(() => drivers.id),
  pickupLocationId: uuid('pickup_location_id')
    .references(() => savedLocations.id)
    .notNull(),
  dropoffLocationId: uuid('dropoff_location_id')
    .references(() => savedLocations.id)
    .notNull(),
  serviceType: text('service_type').default('ride'),               // ride | transit_escort
  date: date('date').notNull(),
  pickupTime: time('pickup_time').notNull(),
  estimatedDurationMinutes: integer('estimated_duration_minutes').default(60),
  label: text('label'),                        // "work 1 to home"
  pickupNeighborhood: text('pickup_neighborhood'),
  dropoffNeighborhood: text('dropoff_neighborhood'),
  requiresCleanVehicle: boolean('requires_clean_vehicle').default(false),
  passengerCount: integer('passenger_count').default(1),
  carSeatRequired: boolean('car_seat_required').default(false),
  status: text('status').default('open'),      // open|claimed|confirmed|in_progress|completed|cancelled|no_show
  claimedAt: timestamp('claimed_at'),
  confirmedAt: timestamp('confirmed_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  cancelledAt: timestamp('cancelled_at'),
  cancellationReason: text('cancellation_reason'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- driver_passenger_affinity ----------
// Tracks ongoing driver-passenger relationships for ride continuity
export const driverPassengerAffinity = pgTable('driver_passenger_affinity', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  driverId: uuid('driver_id')
    .references(() => drivers.id, { onDelete: 'cascade' })
    .notNull(),
  recipientId: uuid('recipient_id')
    .references(() => recipients.id, { onDelete: 'cascade' })
    .notNull(),
  rideCount: integer('ride_count').default(0),
  preferred: boolean('preferred').default(false),
  lastRideDate: date('last_ride_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- whatsapp_lines ----------
// Multiple WhatsApp numbers: one primary (outbound notifications) + pool for blind relay
export const whatsappLines = pgTable('whatsapp_lines', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  label: text('label').notNull(),                          // "Main Line", "Relay #3"
  phoneNumber: text('phone_number'),                       // E.164 once connected
  status: text('status').default('disconnected'),          // disconnected|connecting|qr_ready|connected
  isPrimary: boolean('is_primary').default(false),         // the main outbound notification line
  isRelayPool: boolean('is_relay_pool').default(false),    // available for blind driver<->recipient relay
  authDir: text('auth_dir').notNull(),                     // path to Baileys auth state
  lastConnectedAt: timestamp('last_connected_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- whatsapp_relay_sessions ----------
// Active blind relay: driver <-> pool number <-> recipient
export const whatsappRelaySessions = pgTable('whatsapp_relay_sessions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  whatsappLineId: uuid('whatsapp_line_id')
    .references(() => whatsappLines.id)
    .notNull(),
  driverPhoneEnc: text('driver_phone_enc').notNull(),
  recipientPhoneEnc: text('recipient_phone_enc').notNull(),
  dispatchSessionId: uuid('dispatch_session_id').references(() => dispatchSessions.id),
  shiftId: uuid('shift_id').references(() => shifts.id),
  active: boolean('active').default(true),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- intake_requests ----------
// Raw ride/delivery requests from any channel, before coordinator processes them
export const intakeRequests = pgTable('intake_requests', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  source: text('source').notNull(),            // whatsapp|signal|jotform|web_form|manual
  sourceIdentifier: text('source_identifier'), // phone hash, form ID, etc.
  rawText: text('raw_text'),
  parsedData: jsonb('parsed_data'),
  status: text('status').default('pending'),   // pending|processed|rejected
  processedBy: uuid('processed_by').references(() => adminUsers.id),
  processedAt: timestamp('processed_at'),
  linkedRecipientId: uuid('linked_recipient_id').references(() => recipients.id),
  linkedRideScheduleId: uuid('linked_ride_schedule_id').references(() => rideSchedules.id),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------- referral_providers ----------
// Vetted professionals and services that admins can search instead of 50+ person Signal chats
export const referralProviders = pgTable('referral_providers', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  category: text('category').notNull(),            // medical, legal, automotive, etc.
  nameEnc: text('name_enc').notNull(),             // pgp_sym_encrypt(name, DEK)
  nameHash: text('name_hash').notNull(),           // HMAC for lookups
  businessNameEnc: text('business_name_enc'),
  phoneEnc: text('phone_enc'),
  phoneHash: text('phone_hash'),
  emailEnc: text('email_enc'),
  addressEnc: text('address_enc'),
  neighborhoods: text('neighborhoods').array().default([]),
  lat: numeric('lat'),
  lng: numeric('lng'),
  languages: text('languages').array().default(['en']),
  lowBono: boolean('low_bono').default(false),
  slidingScale: boolean('sliding_scale').default(false),
  acceptsUninsured: boolean('accepts_uninsured').default(false),
  specialties: text('specialties').array().default([]),
  notes: text('notes'),
  status: text('status').default('under_review'),  // active | inactive | under_review
  createdBy: uuid('created_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------- referral_vouches ----------
// Which admins vouch for which providers, with trust level
export const referralVouches = pgTable('referral_vouches', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  providerId: uuid('provider_id')
    .references(() => referralProviders.id, { onDelete: 'cascade' })
    .notNull(),
  adminId: uuid('admin_id')
    .references(() => adminUsers.id)
    .notNull(),
  level: text('level').notNull().default('community_known'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  uniqueIndex('referral_vouches_provider_admin_unique').on(table.providerId, table.adminId),
]);

// ---------- referral_lookups ----------
// Search audit log — what was searched, by whom
export const referralLookups = pgTable('referral_lookups', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  adminId: uuid('admin_id')
    .references(() => adminUsers.id)
    .notNull(),
  query: text('query'),
  category: text('category'),
  neighborhood: text('neighborhood'),
  resultCount: integer('result_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});
