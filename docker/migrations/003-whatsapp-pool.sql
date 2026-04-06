-- Migration: 003-whatsapp-pool
-- Adds WhatsApp line pool tables for multi-line blind relay support.
--
-- Adds support for multiple WhatsApp numbers: one primary (outbound
-- notifications) plus a pool of relay lines that bridge drivers and
-- recipients without exposing either party's real phone number.
--
-- Run against an existing SafeCare database.
-- Safe to run multiple times.

BEGIN;

-- ---------- whatsapp_lines ----------
CREATE TABLE IF NOT EXISTS whatsapp_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  phone_number TEXT,
  status TEXT DEFAULT 'disconnected',
  is_primary BOOLEAN DEFAULT false,
  is_relay_pool BOOLEAN DEFAULT false,
  auth_dir TEXT NOT NULL,
  last_connected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- whatsapp_relay_sessions ----------
CREATE TABLE IF NOT EXISTS whatsapp_relay_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_line_id UUID NOT NULL REFERENCES whatsapp_lines(id),
  driver_phone_enc TEXT NOT NULL,
  recipient_phone_enc TEXT NOT NULL,
  dispatch_session_id UUID REFERENCES dispatch_sessions(id),
  shift_id UUID REFERENCES shifts(id),
  active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_relay_line ON whatsapp_relay_sessions(whatsapp_line_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_relay_active ON whatsapp_relay_sessions(active);

COMMIT;
