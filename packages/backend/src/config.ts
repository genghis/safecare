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
  readonly JOTFORM_API_KEY: string | undefined;
  readonly PORT: number;
  readonly HOST: string;
  readonly NODE_ENV: string;
  readonly GEOCODING_URL: string;
  readonly OSRM_URL: string;
  readonly PROVISION_SERVICE_URL: string;
} = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgres://safecare:safecare@localhost:5432/safecare',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  JWT_SECRET: required('JWT_SECRET'),
  // DEK starts empty — loaded at runtime via POST /api/setup/unlock.
  // If DEK is in the env (dev/legacy), use it. Otherwise the system boots "locked".
  DEK: process.env.DEK ?? '',
  HMAC_KEY: required('HMAC_KEY'),
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ?? '',
  SIGNAL_CLI_URL: process.env.SIGNAL_CLI_URL ?? '',
  SIGNAL_PHONE_NUMBER: process.env.SIGNAL_PHONE_NUMBER ?? '',
  JOTFORM_API_KEY: process.env.JOTFORM_API_KEY,
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  HOST: process.env.HOST ?? '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  GEOCODING_URL: process.env.GEOCODING_URL ?? 'https://nominatim.openstreetmap.org',
  OSRM_URL: process.env.OSRM_URL ?? 'http://localhost:5000',
  PROVISION_SERVICE_URL: process.env.PROVISION_SERVICE_URL ?? 'https://provision.safecare.dev',
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
