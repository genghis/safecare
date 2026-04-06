/**
 * Direct-to-Postgres seeding for dummy data.
 *
 * All seeders here write plain-text or pgcrypto-encrypted fields via
 * `pgp_sym_encrypt(..., $1::text)` where $1 is the DEK.
 *
 * Every seed function is labeled with a service type (WhatsApp, recipients,
 * drivers, etc.) so we can grep this file to see everything the harness
 * ever writes.
 */

import pg from 'pg';
import { URLS, getSecrets } from './stack.mjs';

export async function connect() {
  const client = new pg.Client({ connectionString: URLS.postgres });
  await client.connect();
  return client;
}

/**
 * Run a parameterized query using pgp_sym_encrypt for PII fields.
 *
 * IMPORTANT: the DEK is a parameter (not interpolated into SQL), so we
 * avoid any injection risk and match exactly what the backend does in
 * its recipient.service.ts calls.
 */
function requireSecrets() {
  const s = getSecrets();
  if (!s.DEK) throw new Error('seed: DEK not set — bootstrap must run before seeding encrypted rows');
  if (!s.HMAC_KEY) throw new Error('seed: HMAC_KEY not set — backend must be started first');
  return s;
}

// ============================================================
// WhatsApp Lines
// ============================================================

// Phone numbers stored WITHOUT leading + because the dashboard UI prefixes
// "+" when rendering (settings/page.tsx line 1246: `+{line.phoneNumber}`).
export const DUMMY_WHATSAPP_LINES = {
  primary: {
    label: 'Main Line',
    phoneNumber: '16125550101',
    isPrimary: true,
    isRelayPool: false,
  },
  relays: [
    { label: 'Relay #1', phoneNumber: '16125550234', isPrimary: false, isRelayPool: true },
    { label: 'Relay #2', phoneNumber: '16125550318', isPrimary: false, isRelayPool: true },
    { label: 'Relay #3', phoneNumber: '16125550492', isPrimary: false, isRelayPool: true },
    { label: 'Relay #4', phoneNumber: '16125550577', isPrimary: false, isRelayPool: true },
  ],
};

/**
 * Seed one or more WhatsApp lines in the `connected` state.
 *
 * The WhatsApp lines API merges DB rows with live Baileys state.
 * When no Baileys connection exists (our case), it falls back to the
 * DB `status` and `phone_number` columns. Setting those to "connected"
 * and a fake E.164 number makes the UI render exactly as if a real
 * line were paired — with no network calls or WhatsApp account needed.
 */
export async function seedWhatsAppLines(client, lines) {
  const results = [];
  for (const line of lines) {
    const authDir = `/app/whatsapp-auth/dummy-${randId()}`;
    const { rows } = await client.query(
      `INSERT INTO whatsapp_lines
         (label, phone_number, status, is_primary, is_relay_pool, auth_dir, last_connected_at)
       VALUES ($1, $2, 'connected', $3, $4, $5, now())
       RETURNING id, label, phone_number, is_primary, is_relay_pool`,
      [line.label, line.phoneNumber, line.isPrimary, line.isRelayPool, authDir],
    );
    results.push(rows[0]);
  }
  return results;
}

export async function clearWhatsAppLines(client) {
  await client.query('DELETE FROM whatsapp_relay_sessions');
  await client.query('DELETE FROM whatsapp_lines');
}

// ============================================================
// Recipients (encrypted PII)
// ============================================================

export const DUMMY_RECIPIENTS = [
  { name: 'Maria González', phone: '+16125550201', address: '2145 E Lake St, Minneapolis, MN', lat: 44.948, lng: -93.24, language: 'es', pref: 'whatsapp', verified: true },
  { name: 'Fatima Ahmed', phone: '+16125550202', address: '1825 Riverside Ave, Minneapolis, MN', lat: 44.969, lng: -93.247, language: 'ar', pref: 'whatsapp', verified: true },
  { name: 'Amina Farah', phone: '+16125550203', address: '920 Cedar Ave, Minneapolis, MN', lat: 44.964, lng: -93.247, language: 'so', pref: 'whatsapp', verified: true },
  { name: 'Yusuf Ali', phone: '+16125550204', address: '2403 Bloomington Ave, Minneapolis, MN', lat: 44.955, lng: -93.24, language: 'en', pref: 'sms', verified: true },
  { name: 'Isabella Ruiz', phone: '+16125550205', address: '3015 Lyndale Ave S, Minneapolis, MN', lat: 44.944, lng: -93.289, language: 'es', pref: 'signal', verified: true },
  { name: 'Linh Nguyen', phone: '+16125550206', address: '1408 E Franklin Ave, Minneapolis, MN', lat: 44.963, lng: -93.253, language: 'en', pref: 'sms', verified: true },
  { name: 'Nadia Hussein', phone: '+16125550207', address: '515 15th Ave S, Minneapolis, MN', lat: 44.968, lng: -93.248, language: 'ar', pref: 'whatsapp', verified: true },
  { name: 'Rosa Méndez', phone: '+16125550208', address: '3830 Chicago Ave, Minneapolis, MN', lat: 44.935, lng: -93.262, language: 'es', pref: 'whatsapp', verified: false },
  { name: 'Hodan Mohamed', phone: '+16125550209', address: '1010 S 4th St, Minneapolis, MN', lat: 44.974, lng: -93.245, language: 'so', pref: 'whatsapp', verified: true },
  { name: 'Carmen Silva', phone: '+16125550210', address: '2500 E 25th St, Minneapolis, MN', lat: 44.953, lng: -93.236, language: 'es', pref: 'signal', verified: true },
  { name: 'Khadija Said', phone: '+16125550211', address: '310 15th Ave S, Minneapolis, MN', lat: 44.972, lng: -93.248, language: 'ar', pref: 'whatsapp', verified: true },
  { name: 'Elena Ramírez', phone: '+16125550212', address: '3420 Portland Ave, Minneapolis, MN', lat: 44.938, lng: -93.268, language: 'es', pref: 'sms', verified: true },
];

export async function seedRecipients(client, recipients = DUMMY_RECIPIENTS) {
  const { DEK, HMAC_KEY } = requireSecrets();
  const ids = [];
  for (const r of recipients) {
    const { rows } = await client.query(
      `INSERT INTO recipients
         (name_enc, name_hash, address_enc, phone_enc, phone_hash,
          lat, lng, communication_preference, whatsapp_consent, language, verified)
       VALUES (
         pgp_sym_encrypt($1, $2),
         encode(hmac($1, $3, 'sha256'), 'hex'),
         pgp_sym_encrypt($4, $2),
         pgp_sym_encrypt($5, $2),
         encode(hmac($5, $3, 'sha256'), 'hex'),
         $6, $7, $8, $9, $10, $11
       )
       RETURNING id`,
      [
        r.name,
        DEK,
        HMAC_KEY,
        r.address,
        r.phone,
        r.lat,
        r.lng,
        r.pref,
        r.pref === 'whatsapp',
        r.language,
        r.verified,
      ],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

export async function clearRecipients(client) {
  // Clear dependent tables first
  await client.query('DELETE FROM deliveries');
  await client.query('DELETE FROM saved_locations');
  await client.query('DELETE FROM recipients');
}

// ============================================================
// Drivers (encrypted PII, availability, zones, vetting)
// ============================================================

const STANDARD_AVAILABILITY = [
  { day: 'mon', startTime: '09:00', endTime: '17:00' },
  { day: 'tue', startTime: '09:00', endTime: '17:00' },
  { day: 'wed', startTime: '09:00', endTime: '17:00' },
  { day: 'thu', startTime: '09:00', endTime: '17:00' },
  { day: 'fri', startTime: '09:00', endTime: '17:00' },
];

const WEEKEND_AVAILABILITY = [
  { day: 'sat', startTime: '10:00', endTime: '16:00' },
  { day: 'sun', startTime: '10:00', endTime: '16:00' },
];

const EVENING_AVAILABILITY = [
  { day: 'mon', startTime: '17:00', endTime: '20:00' },
  { day: 'wed', startTime: '17:00', endTime: '20:00' },
  { day: 'fri', startTime: '17:00', endTime: '20:00' },
];

export const DUMMY_DRIVERS = [
  { name: 'Sarah Kowalski',     phone: '+16125550301', email: 'sarah.k@example.org', vehicle: 'sedan',    max: 4, vetted: 'vetted',  availability: STANDARD_AVAILABILITY, team: 'Foxes' },
  { name: 'James Martínez',     phone: '+16125550302', email: 'james.m@example.org', vehicle: 'suv',      max: 6, vetted: 'vetted',  availability: STANDARD_AVAILABILITY, team: 'Otters' },
  { name: 'Nadia Hassan',       phone: '+16125550303', email: 'nadia.h@example.org', vehicle: 'minivan',  max: 8, vetted: 'vetted',  availability: WEEKEND_AVAILABILITY, team: 'Hawks' },
  { name: 'Daniel Chen',        phone: '+16125550304', email: 'daniel.c@example.org', vehicle: 'compact', max: 2, vetted: 'vetted',  availability: EVENING_AVAILABILITY, team: 'Squirrels' },
  { name: 'Aisha Johnson',      phone: '+16125550305', email: 'aisha.j@example.org', vehicle: 'sedan',    max: 4, vetted: 'vetted',  availability: STANDARD_AVAILABILITY, team: 'Foxes' },
  { name: 'Omar Rahman',        phone: '+16125550306', email: 'omar.r@example.org', vehicle: 'truck',     max: 10, vetted: 'vetted', availability: WEEKEND_AVAILABILITY, team: 'Bears' },
  { name: 'Priya Patel',        phone: '+16125550307', email: 'priya.p@example.org', vehicle: 'sedan',    max: 4, vetted: 'pending', availability: STANDARD_AVAILABILITY, team: 'Owls' },
  { name: 'Marcus Thompson',    phone: '+16125550308', email: 'marcus.t@example.org', vehicle: 'suv',     max: 5, vetted: 'pending', availability: EVENING_AVAILABILITY, team: 'Reindeer' },
];

export async function seedDrivers(client, drivers = DUMMY_DRIVERS) {
  const { DEK, HMAC_KEY } = requireSecrets();
  const ids = [];
  for (const d of drivers) {
    const { rows } = await client.query(
      `INSERT INTO drivers
         (name_enc, name_hash, phone_enc, phone_hash, email_enc,
          vetted_status, vehicle_size, max_deliveries,
          languages, availability, team_name)
       VALUES (
         pgp_sym_encrypt($1, $2),
         encode(hmac($1, $3, 'sha256'), 'hex'),
         pgp_sym_encrypt($4, $2),
         encode(hmac($4, $3, 'sha256'), 'hex'),
         pgp_sym_encrypt($5, $2),
         $6, $7, $8,
         ARRAY['en']::text[],
         $9::jsonb,
         $10
       )
       RETURNING id`,
      [
        d.name,
        DEK,
        HMAC_KEY,
        d.phone,
        d.email,
        d.vetted,
        d.vehicle,
        d.max,
        JSON.stringify(d.availability),
        d.team,
      ],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

export async function clearDrivers(client) {
  await client.query('DELETE FROM driver_check_ins');
  await client.query('DELETE FROM drivers');
}

// ============================================================
// Zones (polygons drawn on the admin map)
// ============================================================

// Minneapolis-area polygons covering Seward, Phillips, Cedar-Riverside, Lyn-Lake
export const DUMMY_ZONES = [
  {
    name: 'Phillips',
    color: '#3B82F6',
    polygon: [
      { lat: 44.962, lng: -93.262 },
      { lat: 44.962, lng: -93.238 },
      { lat: 44.940, lng: -93.238 },
      { lat: 44.940, lng: -93.262 },
    ],
  },
  {
    name: 'Cedar-Riverside',
    color: '#10B981',
    polygon: [
      { lat: 44.980, lng: -93.256 },
      { lat: 44.980, lng: -93.238 },
      { lat: 44.965, lng: -93.238 },
      { lat: 44.965, lng: -93.256 },
    ],
  },
  {
    name: 'Seward',
    color: '#F59E0B',
    polygon: [
      { lat: 44.965, lng: -93.238 },
      { lat: 44.965, lng: -93.215 },
      { lat: 44.950, lng: -93.215 },
      { lat: 44.950, lng: -93.238 },
    ],
  },
  {
    name: 'Lyn-Lake',
    color: '#A855F7',
    polygon: [
      { lat: 44.950, lng: -93.300 },
      { lat: 44.950, lng: -93.278 },
      { lat: 44.935, lng: -93.278 },
      { lat: 44.935, lng: -93.300 },
    ],
  },
];

function centroid(points) {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

export async function seedZones(client, zones = DUMMY_ZONES) {
  const ids = [];
  for (const z of zones) {
    const c = centroid(z.polygon);
    const { rows } = await client.query(
      `INSERT INTO delivery_zones (name, color, polygon, center_lat, center_lng, active)
       VALUES ($1, $2, $3::jsonb, $4, $5, true)
       RETURNING id`,
      [z.name, z.color, JSON.stringify(z.polygon), c.lat, c.lng],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

export async function clearZones(client) {
  await client.query('DELETE FROM delivery_zones');
}

// ============================================================
// Dispatch session + deliveries + driver check-ins
// ============================================================

/**
 * Create an active dispatch session with:
 *   - N checked-in drivers (first N of driverIds)
 *   - Deliveries in various statuses mapped to recipients
 *   - Some assigned to checked-in drivers, some pending
 *
 * Returns the session id.
 */
export async function seedDispatchSession(
  client,
  { recipientIds, driverIds, checkedInCount = 5, status = 'active' },
) {
  const { DEK } = requireSecrets();

  // Create the session
  const today = new Date().toISOString().slice(0, 10);
  const { rows: sessRows } = await client.query(
    `INSERT INTO dispatch_sessions (date, status, strictness_level, download_token_ttl_minutes, route_data_ttl_hours)
     VALUES ($1, $2, 'standard', 5, 8)
     RETURNING id`,
    [today, status],
  );
  const sessionId = sessRows[0].id;

  // Check in the first N drivers
  const checkedIn = driverIds.slice(0, checkedInCount);
  for (const driverId of checkedIn) {
    await client.query(
      `INSERT INTO driver_check_ins (driver_id, dispatch_session_id, checked_in_at, route_released_at)
       VALUES ($1, $2, now() - interval '45 minutes', now() - interval '20 minutes')`,
      [driverId, sessionId],
    );
  }

  // Create deliveries: mix of statuses tied to the session
  // Distribute recipients across checked-in drivers
  const statuses = ['delivered', 'delivered', 'delivered', 'in_transit', 'in_transit', 'in_transit', 'released', 'released', 'released', 'pending', 'pending', 'pending'];
  for (let i = 0; i < recipientIds.length; i++) {
    const recipientId = recipientIds[i];
    const deliveryStatus = statuses[i % statuses.length];
    const driverId = deliveryStatus === 'pending' ? null : checkedIn[i % checkedIn.length];

    // Get the recipient's address/lat/lng for the delivery row
    const { rows: recRows } = await client.query(
      `SELECT
         pgp_sym_decrypt(address_enc::bytea, $2) AS address,
         lat, lng
       FROM recipients WHERE id = $1`,
      [recipientId, DEK],
    );
    if (!recRows[0]) continue;
    const { address, lat, lng } = recRows[0];

    // Use native SQL expressions for relative timestamps — parameterized
    // values can't express "now() - interval '20 minutes'" as a single param.
    const releasedExpr = deliveryStatus !== 'pending' ? "(now() - interval '20 minutes')" : 'NULL';
    const deliveredExpr = deliveryStatus === 'delivered' ? "(now() - interval '5 minutes')" : 'NULL';

    await client.query(
      `INSERT INTO deliveries
         (recipient_id, driver_id, dispatch_session_id, status,
          address_enc, lat, lng, notes, released_at, delivered_at)
       VALUES (
         $1, $2, $3, $4,
         pgp_sym_encrypt($5, $6),
         $7, $8, $9,
         ${releasedExpr}, ${deliveredExpr}
       )`,
      [recipientId, driverId, sessionId, deliveryStatus, address, DEK, lat, lng, null],
    );
  }

  return sessionId;
}

export async function clearDispatch(client) {
  await client.query('DELETE FROM download_tokens');
  await client.query('DELETE FROM driver_check_ins');
  await client.query('DELETE FROM deliveries');
  await client.query('DELETE FROM dispatch_sessions');
}

function randId() {
  return Math.random().toString(36).slice(2, 10);
}
