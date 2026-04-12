-- Migration: 004-clean-cars-referrals
-- Adds vehicle status / capacity refinements from coordinator feedback,
-- transit escort service type, and the vetted referral network.
--
-- Safe to run multiple times (all statements use IF NOT EXISTS patterns).

BEGIN;

-- ========== Part 1: Vehicle & ride refinements ==========

-- Add vehicle security status (clean / hot / unknown)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'vehicle_status'
  ) THEN
    ALTER TABLE drivers ADD COLUMN vehicle_status TEXT DEFAULT 'unknown';
  END IF;

  -- Separate passenger capacity from cargo capacity
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'passenger_capacity'
  ) THEN
    ALTER TABLE drivers ADD COLUMN passenger_capacity INTEGER DEFAULT 4;
  END IF;

  -- Insurance tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'insurance_verified'
  ) THEN
    ALTER TABLE drivers ADD COLUMN insurance_verified BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'insurance_notes'
  ) THEN
    ALTER TABLE drivers ADD COLUMN insurance_notes TEXT;
  END IF;

  -- Service radius (neighborhood / metro / regional)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'service_radius'
  ) THEN
    ALTER TABLE drivers ADD COLUMN service_radius TEXT DEFAULT 'neighborhood';
  END IF;
END $$;

-- Add ride-specific fields to shifts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'requires_clean_vehicle'
  ) THEN
    ALTER TABLE shifts ADD COLUMN requires_clean_vehicle BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'passenger_count'
  ) THEN
    ALTER TABLE shifts ADD COLUMN passenger_count INTEGER DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'car_seat_required'
  ) THEN
    ALTER TABLE shifts ADD COLUMN car_seat_required BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'service_type'
  ) THEN
    ALTER TABLE shifts ADD COLUMN service_type TEXT DEFAULT 'ride';
  END IF;
END $$;

-- ========== Part 2: Vetted referral network ==========

-- Referral providers — the vetted professionals and services
CREATE TABLE IF NOT EXISTS referral_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,                          -- medical, legal, automotive, etc.
  name_enc TEXT NOT NULL,                          -- pgp_sym_encrypt(name, DEK)
  name_hash TEXT NOT NULL,                         -- HMAC for lookups
  business_name_enc TEXT,                          -- pgp_sym_encrypt(business_name, DEK)
  phone_enc TEXT,                                  -- pgp_sym_encrypt(phone, DEK)
  phone_hash TEXT,                                 -- HMAC for dedup
  email_enc TEXT,                                  -- pgp_sym_encrypt(email, DEK)
  address_enc TEXT,                                -- pgp_sym_encrypt(address, DEK)
  neighborhoods TEXT[] DEFAULT '{}',               -- coarse areas served
  lat NUMERIC,
  lng NUMERIC,
  languages TEXT[] DEFAULT '{en}',
  low_bono BOOLEAN DEFAULT false,                  -- offers reduced/free services
  sliding_scale BOOLEAN DEFAULT false,
  accepts_uninsured BOOLEAN DEFAULT false,
  specialties TEXT[] DEFAULT '{}',                 -- free-text tags
  notes TEXT,
  status TEXT DEFAULT 'under_review',              -- active | inactive | under_review
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_providers_category ON referral_providers(category);
CREATE INDEX IF NOT EXISTS idx_referral_providers_status ON referral_providers(status);
CREATE INDEX IF NOT EXISTS idx_referral_providers_name_hash ON referral_providers(name_hash);

-- Referral vouches — which admins vouch for which providers
CREATE TABLE IF NOT EXISTS referral_vouches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES referral_providers(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  level TEXT NOT NULL DEFAULT 'community_known',   -- personally_used | trusted_referral | community_known
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(provider_id, admin_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_vouches_provider ON referral_vouches(provider_id);

-- Referral lookups — search audit log
CREATE TABLE IF NOT EXISTS referral_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  query TEXT,
  category TEXT,
  neighborhood TEXT,
  result_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_lookups_admin ON referral_lookups(admin_id);

COMMIT;
