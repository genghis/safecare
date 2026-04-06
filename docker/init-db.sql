CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- recipients ----------
CREATE TABLE IF NOT EXISTS recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_enc TEXT NOT NULL,
  name_hash TEXT NOT NULL,
  address_enc TEXT NOT NULL,
  phone_enc TEXT NOT NULL,
  phone_hash TEXT NOT NULL UNIQUE,
  lat NUMERIC,
  lng NUMERIC,
  communication_preference TEXT DEFAULT 'sms',
  whatsapp_consent BOOLEAN DEFAULT false,
  language TEXT DEFAULT 'en',
  verified BOOLEAN DEFAULT false,
  display_id TEXT,                     -- short ID for schedules: "P2", "P3"
  service_types TEXT[] DEFAULT '{delivery}', -- delivery|ride
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- delivery_zones ----------
CREATE TABLE IF NOT EXISTS delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  polygon JSONB NOT NULL,
  center_lat NUMERIC,
  center_lng NUMERIC,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- drivers ----------
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_enc TEXT NOT NULL,
  name_hash TEXT,
  phone_enc TEXT NOT NULL,
  phone_hash TEXT NOT NULL UNIQUE,
  email_enc TEXT,
  vetted_status TEXT DEFAULT 'pending',
  vehicle_size TEXT DEFAULT 'sedan',
  vehicle_model TEXT,
  vehicle_description_enc TEXT,        -- encrypted free-text: "red ford focus"
  max_deliveries INTEGER DEFAULT 3,
  max_rides_per_week INTEGER DEFAULT 10,
  service_types TEXT[] DEFAULT '{delivery}', -- delivery|ride
  languages TEXT[],
  availability JSONB DEFAULT '[]',
  delivery_zone_ids TEXT[] DEFAULT '{}',
  team_name TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- admin_users ----------
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  totp_secret TEXT,
  totp_backup_codes TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- dispatch_sessions ----------
CREATE TABLE IF NOT EXISTS dispatch_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  status TEXT DEFAULT 'draft',
  created_by UUID REFERENCES admin_users(id),
  strictness_level TEXT DEFAULT 'standard',
  download_token_ttl_minutes INTEGER DEFAULT 5,
  route_data_ttl_hours INTEGER DEFAULT 8,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- deliveries ----------
CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID REFERENCES recipients(id),
  driver_id UUID REFERENCES drivers(id),
  dispatch_session_id UUID REFERENCES dispatch_sessions(id),
  status TEXT DEFAULT 'pending',
  address_enc TEXT,
  lat NUMERIC,
  lng NUMERIC,
  notes TEXT,
  released_at TIMESTAMP,
  delivered_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- driver_check_ins ----------
CREATE TABLE IF NOT EXISTS driver_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id),
  dispatch_session_id UUID NOT NULL REFERENCES dispatch_sessions(id),
  checked_in_at TIMESTAMP DEFAULT now(),
  route_released_at TIMESTAMP,
  route_downloaded_at TIMESTAMP,
  purge_confirmed_at TIMESTAMP
);

-- ---------- communication_sessions ----------
CREATE TABLE IF NOT EXISTS communication_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_phone_enc TEXT,
  recipient_phone_enc TEXT,
  twilio_proxy_number TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- download_tokens ----------
CREATE TABLE IF NOT EXISTS download_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id),
  dispatch_session_id UUID NOT NULL REFERENCES dispatch_sessions(id),
  token_hash TEXT NOT NULL UNIQUE,
  used BOOLEAN DEFAULT false,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- dek_canary ----------
-- Single-row table: stores pgp_sym_encrypt('safecare', DEK).
-- Used to validate the DEK on unlock without needing any real data.
CREATE TABLE IF NOT EXISTS dek_canary (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  encrypted_value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- saved_locations ----------
-- Multiple named addresses per recipient/passenger (e.g. "home", "work 1", "work 2")
CREATE TABLE IF NOT EXISTS saved_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                -- human-readable: "home", "work 1", "school"
  address_enc TEXT NOT NULL,          -- pgp_sym_encrypt(address, DEK)
  lat NUMERIC,
  lng NUMERIC,
  neighborhood TEXT,                  -- unencrypted, coarse area for shift board display
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- ride_schedules ----------
-- Recurring ride templates (e.g. "P2: work 1 → home, Mon/Wed/Fri at 13:30")
CREATE TABLE IF NOT EXISTS ride_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  pickup_location_id UUID NOT NULL REFERENCES saved_locations(id),
  dropoff_location_id UUID NOT NULL REFERENCES saved_locations(id),
  days_of_week TEXT[] NOT NULL,       -- e.g. '{mon,wed,fri}'
  pickup_time TIME NOT NULL,          -- e.g. '13:30'
  estimated_duration_minutes INTEGER DEFAULT 60,
  label TEXT,                         -- schedule display label: "work 1 to home"
  notes TEXT,                         -- special instructions
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- shifts ----------
-- Individual ride instances (generated from ride_schedules or ad-hoc)
-- This is the ride equivalent of "deliveries" — but uses driver-claim model
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_schedule_id UUID REFERENCES ride_schedules(id),  -- NULL if ad-hoc
  recipient_id UUID NOT NULL REFERENCES recipients(id),
  driver_id UUID REFERENCES drivers(id),                -- NULL until claimed
  pickup_location_id UUID NOT NULL REFERENCES saved_locations(id),
  dropoff_location_id UUID NOT NULL REFERENCES saved_locations(id),
  date DATE NOT NULL,
  pickup_time TIME NOT NULL,
  estimated_duration_minutes INTEGER DEFAULT 60,
  label TEXT,                          -- "work 1 to home" (shown on shift board)
  pickup_neighborhood TEXT,            -- coarse area for shift board (no addresses)
  dropoff_neighborhood TEXT,           -- coarse area for shift board (no addresses)
  status TEXT DEFAULT 'open',          -- open|claimed|confirmed|in_progress|completed|cancelled|no_show
  claimed_at TIMESTAMP,
  confirmed_at TIMESTAMP,             -- coordinator confirms the claim
  started_at TIMESTAMP,               -- driver marks "on my way"
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancellation_reason TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_driver ON shifts(driver_id);
CREATE INDEX IF NOT EXISTS idx_shifts_recipient ON shifts(recipient_id);

-- ---------- driver_passenger_affinity ----------
-- Tracks ongoing relationships between drivers and passengers
CREATE TABLE IF NOT EXISTS driver_passenger_affinity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  ride_count INTEGER DEFAULT 0,
  preferred BOOLEAN DEFAULT false,     -- coordinator can flag preferred pairings
  last_ride_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(driver_id, recipient_id)
);

-- ---------- intake_requests ----------
-- Raw ride/delivery requests from any channel, before coordinator processes them
CREATE TABLE IF NOT EXISTS intake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                -- whatsapp|signal|jotform|web_form|manual
  source_identifier TEXT,              -- phone number hash, form ID, etc.
  raw_text TEXT,                       -- original message text
  parsed_data JSONB,                   -- extracted fields (name, address, times, etc.)
  status TEXT DEFAULT 'pending',       -- pending|processed|rejected
  processed_by UUID REFERENCES admin_users(id),
  processed_at TIMESTAMP,
  linked_recipient_id UUID REFERENCES recipients(id),
  linked_ride_schedule_id UUID REFERENCES ride_schedules(id),
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_requests(status);

-- ---------- audit_log ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID,
  admin_id UUID,
  action TEXT NOT NULL,
  ip TEXT,
  details JSONB,
  stop_count INTEGER,
  completed_count INTEGER,
  released_at TIMESTAMP,
  purged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);
