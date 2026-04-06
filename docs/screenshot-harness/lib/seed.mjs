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
import { URLS } from './stack.mjs';

export async function connect() {
  const client = new pg.Client({ connectionString: URLS.postgres });
  await client.connect();
  return client;
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
// (Placeholder for future seeders — drivers, recipients, etc.)
// ============================================================
// Each new seeder follows the same pattern:
//   1. Export a DUMMY_X constant describing the dummy data
//   2. Export a seedX(client, ...) async function
//   3. Export a clearX(client) async function

function randId() {
  return Math.random().toString(36).slice(2, 10);
}
