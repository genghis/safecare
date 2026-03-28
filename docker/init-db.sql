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
  verified BOOLEAN DEFAULT false,
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
  max_deliveries INTEGER DEFAULT 3,
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

-- ---------- audit_log ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID,
  action TEXT NOT NULL,
  stop_count INTEGER,
  completed_count INTEGER,
  released_at TIMESTAMP,
  purged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);
