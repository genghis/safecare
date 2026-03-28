import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgres://safecare:safecare@localhost:5432/safecare',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  JWT_SECRET: required('JWT_SECRET'),
  DEK: required('DEK'),
  HMAC_KEY: required('HMAC_KEY'),
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  JOTFORM_API_KEY: process.env.JOTFORM_API_KEY,
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  HOST: process.env.HOST ?? '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  GEOCODING_URL: process.env.GEOCODING_URL ?? 'https://nominatim.openstreetmap.org',
} as const;
