-- Migration: 002-ride-coordination
-- Adds ride coordination support: saved locations, ride schedules, shifts,
-- driver-passenger affinity tracking, and intake request processing.
--
-- Run against an existing SafeCare database to add ride coordination.
-- Safe to run multiple times (all statements use IF NOT EXISTS / IF NOT EXISTS patterns).

BEGIN;

-- ---------- Extend recipients with ride fields ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'recipients' AND column_name = 'display_id'
  ) THEN
    ALTER TABLE recipients ADD COLUMN display_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'recipients' AND column_name = 'service_types'
  ) THEN
    ALTER TABLE recipients ADD COLUMN service_types TEXT[] DEFAULT '{delivery}';
  END IF;
END $$;

-- ---------- Extend drivers with ride fields ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'vehicle_description_enc'
  ) THEN
    ALTER TABLE drivers ADD COLUMN vehicle_description_enc TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'max_rides_per_week'
  ) THEN
    ALTER TABLE drivers ADD COLUMN max_rides_per_week INTEGER DEFAULT 10;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drivers' AND column_name = 'service_types'
  ) THEN
    ALTER TABLE drivers ADD COLUMN service_types TEXT[] DEFAULT '{delivery}';
  END IF;
END $$;

-- ---------- saved_locations ----------
CREATE TABLE IF NOT EXISTS saved_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address_enc TEXT NOT NULL,
  lat NUMERIC,
  lng NUMERIC,
  neighborhood TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- ride_schedules ----------
CREATE TABLE IF NOT EXISTS ride_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  pickup_location_id UUID NOT NULL REFERENCES saved_locations(id),
  dropoff_location_id UUID NOT NULL REFERENCES saved_locations(id),
  days_of_week TEXT[] NOT NULL,
  pickup_time TIME NOT NULL,
  estimated_duration_minutes INTEGER DEFAULT 60,
  label TEXT,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- shifts ----------
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_schedule_id UUID REFERENCES ride_schedules(id),
  recipient_id UUID NOT NULL REFERENCES recipients(id),
  driver_id UUID REFERENCES drivers(id),
  pickup_location_id UUID NOT NULL REFERENCES saved_locations(id),
  dropoff_location_id UUID NOT NULL REFERENCES saved_locations(id),
  date DATE NOT NULL,
  pickup_time TIME NOT NULL,
  estimated_duration_minutes INTEGER DEFAULT 60,
  label TEXT,
  pickup_neighborhood TEXT,
  dropoff_neighborhood TEXT,
  status TEXT DEFAULT 'open',
  claimed_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  started_at TIMESTAMP,
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
CREATE TABLE IF NOT EXISTS driver_passenger_affinity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  ride_count INTEGER DEFAULT 0,
  preferred BOOLEAN DEFAULT false,
  last_ride_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(driver_id, recipient_id)
);

-- ---------- intake_requests ----------
CREATE TABLE IF NOT EXISTS intake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_identifier TEXT,
  raw_text TEXT,
  parsed_data JSONB,
  status TEXT DEFAULT 'pending',
  processed_by UUID REFERENCES admin_users(id),
  processed_at TIMESTAMP,
  linked_recipient_id UUID REFERENCES recipients(id),
  linked_ride_schedule_id UUID REFERENCES ride_schedules(id),
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_requests(status);

COMMIT;
