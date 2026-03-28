import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import Redis from 'ioredis';
import { db } from '../db/index.js';
import { adminUsers, drivers } from '../db/schema.js';
import { config } from '../config.js';
import { generateOTP, JWT_EXPIRY } from '@safecare/shared';

const redis = new Redis(config.REDIS_URL);

const SALT_ROUNDS = 12;
const OTP_TTL_SECONDS = 300; // 5 minutes
const OTP_PREFIX = 'otp:';

export class AuthService {
  /**
   * Create a new admin user with bcrypt-hashed password.
   */
  async createAdmin(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await db
      .insert(adminUsers)
      .values({
        email,
        passwordHash,
        role: 'admin',
      })
      .returning({ id: adminUsers.id, email: adminUsers.email, role: adminUsers.role });

    return result[0];
  }

  /**
   * Authenticate an admin user and return a signed JWT.
   */
  async loginAdmin(
    email: string,
    password: string,
    signJwt: (payload: object, options: object) => string,
  ): Promise<{ token: string; admin: { id: string; email: string; role: string | null } } | null> {
    const rows = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email));

    const admin = rows[0];
    if (!admin) return null;

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return null;

    const token = signJwt(
      { sub: admin.id, role: admin.role },
      { expiresIn: JWT_EXPIRY },
    );

    return {
      token,
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  }

  /**
   * Check whether any admin users exist in the database.
   */
  async adminExists(): Promise<boolean> {
    const rows = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Generate and store an OTP for a driver phone number.
   * Returns the OTP (in production, this would be sent via SMS).
   */
  async driverRequestOTP(phone: string): Promise<string> {
    const otp = generateOTP();
    const phoneHash = crypto
      .createHmac('sha256', config.HMAC_KEY)
      .update(phone)
      .digest('hex');

    await redis.setex(`${OTP_PREFIX}${phoneHash}`, OTP_TTL_SECONDS, otp);

    return otp;
  }

  /**
   * Verify an OTP for a driver phone number and return a signed JWT.
   */
  async driverVerifyOTP(
    phone: string,
    otp: string,
    signJwt: (payload: object, options: object) => string,
  ): Promise<{ token: string; driverId: string } | null> {
    const phoneHash = crypto
      .createHmac('sha256', config.HMAC_KEY)
      .update(phone)
      .digest('hex');

    const storedOtp = await redis.get(`${OTP_PREFIX}${phoneHash}`);
    if (!storedOtp || storedOtp !== otp) return null;

    // Delete the OTP after successful verification
    await redis.del(`${OTP_PREFIX}${phoneHash}`);

    // Look up the driver by phone hash
    const rows = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(
        eq(
          drivers.phoneHash,
          sql`encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        ),
      );

    const driver = rows[0];
    if (!driver) return null;

    const token = signJwt(
      { sub: driver.id, role: 'driver' },
      { expiresIn: JWT_EXPIRY },
    );

    return { token, driverId: driver.id };
  }
}

export const authService = new AuthService();
