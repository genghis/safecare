import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Mutable config object — DEK is loaded at runtime via the unlock endpoint.
// All other fields are immutable after startup.
export const config: {
  readonly DATABASE_URL: string;
  readonly REDIS_URL: string;
  readonly JWT_SECRET: string;
  DEK: string;
  readonly HMAC_KEY: string;
  readonly TWILIO_ACCOUNT_SID: string | undefined;
  readonly TWILIO_AUTH_TOKEN: string | undefined;
  readonly TWILIO_PHONE_NUMBER: string;
  readonly SIGNAL_CLI_URL: string;
  readonly SIGNAL_PHONE_NUMBER: string;
  readonly WHATSAPP_AUTH_DIR: string;
  readonly JOTFORM_API_KEY: string | undefined;
  readonly PUBLIC_BASE_URL: string | undefined;
  readonly PORT: number;
  readonly HOST: string;
  readonly NODE_ENV: string;
  readonly GEOCODING_URL: string;
  readonly OSRM_URL: string;
  readonly TILE_URL_TEMPLATE: string;
  readonly TILE_DOWNLOAD_URL_TEMPLATE: string;
  readonly TILE_STORAGE_PATH: string;
  readonly TILE_SUBDOMAINS: string[];
  readonly TILE_DOWNLOAD_SUBDOMAINS: string[];
  readonly TILE_MIN_ZOOM: number;
  readonly TILE_MAX_ZOOM: number;
  readonly PROVISION_SERVICE_URL: string;
  readonly ALLOW_TEST_OTP_ECHO: boolean;
  // When local Nominatim isn't reachable (typical pre-provision setup),
  // fall back to the public nominatim.openstreetmap.org. Defaults on so the
  // wizard's region picker works out of the box. Set to false for fully
  // air-gapped deployments that should NEVER egress to OSM.
  readonly USE_PUBLIC_GEOCODE_FALLBACK: boolean;
} = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgres://safecare:safecare@localhost:5432/safecare',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  JWT_SECRET: required('JWT_SECRET'),
  // DEK starts empty and must be supplied through the unlock flow.
  // Plaintext env loading is allowed only in automated test environments.
  DEK: process.env.NODE_ENV === 'test' ? process.env.DEK ?? '' : '',
  HMAC_KEY: required('HMAC_KEY'),
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ?? '',
  SIGNAL_CLI_URL: process.env.SIGNAL_CLI_URL ?? '',
  SIGNAL_PHONE_NUMBER: process.env.SIGNAL_PHONE_NUMBER ?? '',
  WHATSAPP_AUTH_DIR: process.env.WHATSAPP_AUTH_DIR ?? '/app/whatsapp-auth',
  JOTFORM_API_KEY: process.env.JOTFORM_API_KEY,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  HOST: process.env.HOST ?? '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  GEOCODING_URL: process.env.GEOCODING_URL ?? 'http://localhost:8088',
  OSRM_URL: process.env.OSRM_URL ?? 'http://localhost:5000',
  TILE_URL_TEMPLATE: process.env.TILE_URL_TEMPLATE ?? '',
  // Leave upstream tile download blank by default. SafeCare is expected to
  // serve tiles that already exist under TILE_STORAGE_PATH.
  TILE_DOWNLOAD_URL_TEMPLATE: process.env.TILE_DOWNLOAD_URL_TEMPLATE ?? '',
  TILE_STORAGE_PATH: process.env.TILE_STORAGE_PATH ?? '/app/map-data/tiles',
  TILE_SUBDOMAINS: (process.env.TILE_SUBDOMAINS ?? 'a,b,c')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  TILE_DOWNLOAD_SUBDOMAINS: (process.env.TILE_DOWNLOAD_SUBDOMAINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  TILE_MIN_ZOOM: parseInt(process.env.TILE_MIN_ZOOM ?? '12', 10),
  TILE_MAX_ZOOM: parseInt(process.env.TILE_MAX_ZOOM ?? '16', 10),
  PROVISION_SERVICE_URL: process.env.PROVISION_SERVICE_URL ?? 'https://provision.safecare.dev',
  // Explicit opt-in only — never auto-enable based on NODE_ENV.
  // Set ALLOW_TEST_OTP_ECHO=true in .env or docker-compose for test harnesses.
  ALLOW_TEST_OTP_ECHO: process.env.ALLOW_TEST_OTP_ECHO === 'true',
  USE_PUBLIC_GEOCODE_FALLBACK: process.env.USE_PUBLIC_GEOCODE_FALLBACK !== 'false',
};

/**
 * Set the DEK at runtime (called by the unlock endpoint).
 */
export function setDEK(key: string): void {
  config.DEK = key;
}

/**
 * Returns true if the DEK has been loaded (system is unlocked).
 */
export function isUnlocked(): boolean {
  return config.DEK !== '';
}
