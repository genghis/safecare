import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import Redis from 'ioredis';
import { TOTP, Secret } from 'otpauth';
import { db } from '../db/index.js';
import { adminUsers, drivers } from '../db/schema.js';
import { config } from '../config.js';
import { generateOTP, JWT_EXPIRY } from '@safecare/shared';

const redis = new Redis(config.REDIS_URL);

const SALT_ROUNDS = 12;
const OTP_TTL_SECONDS = 300; // 5 minutes
const OTP_PREFIX = 'otp:';
const TOTP_TEMP_PREFIX = 'totp_temp:';

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
   * Authenticate an admin user and return a signed JWT, or a temp token if TOTP is required.
   */
  async loginAdmin(
    email: string,
    password: string,
    signJwt: (payload: object, options: object) => string,
  ): Promise<
    | { token: string; admin: { id: string; email: string; role: string | null } }
    | { requiresTotp: true; tempToken: string }
    | null
  > {
    const rows = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email));

    const admin = rows[0];
    if (!admin) return null;

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return null;

    // If TOTP is enabled, issue a short-lived temp token instead of the real JWT
    if (admin.totpSecret) {
      const tempToken = crypto.randomBytes(32).toString('hex');
      await redis.setex(
        `${TOTP_TEMP_PREFIX}${tempToken}`,
        OTP_TTL_SECONDS,
        JSON.stringify({ adminId: admin.id, email: admin.email, role: admin.role }),
      );
      return { requiresTotp: true, tempToken };
    }

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
   * Verify a TOTP code using a temp token (from login) and return the real JWT.
   */
  async verifyTotpLogin(
    tempToken: string,
    totpCode: string,
    signJwt: (payload: object, options: object) => string,
  ): Promise<{ token: string; admin: { id: string; email: string; role: string | null } } | null> {
    const raw = await redis.get(`${TOTP_TEMP_PREFIX}${tempToken}`);
    if (!raw) return null;

    const { adminId, email, role } = JSON.parse(raw) as {
      adminId: string;
      email: string;
      role: string;
    };

    const verified = await this.verifyTotp(adminId, totpCode);
    if (!verified) return null;

    // Delete the temp token after successful verification
    await redis.del(`${TOTP_TEMP_PREFIX}${tempToken}`);

    const token = signJwt(
      { sub: adminId, role },
      { expiresIn: JWT_EXPIRY },
    );

    return { token, admin: { id: adminId, email, role } };
  }

  /**
   * Generate a new TOTP secret for QR code setup.
   */
  generateTotpSecret(email: string): { secret: string; uri: string } {
    const secret = new Secret();
    const totp = new TOTP({
      issuer: 'SafeCare',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    return {
      secret: secret.base32,
      uri: totp.toString(),
    };
  }

  /**
   * Enable TOTP for an admin by verifying the token against the secret and saving it.
   */
  async enableTotp(adminId: string, secret: string, token: string): Promise<boolean> {
    const totp = new TOTP({
      issuer: 'SafeCare',
      label: '',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token, window: 1 });
    if (delta === null) return false;

    await db
      .update(adminUsers)
      .set({ totpSecret: secret })
      .where(eq(adminUsers.id, adminId));

    return true;
  }

  /**
   * Verify a TOTP token for an admin.
   */
  async verifyTotp(adminId: string, token: string): Promise<boolean> {
    const rows = await db
      .select({ totpSecret: adminUsers.totpSecret })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId));

    const admin = rows[0];
    if (!admin?.totpSecret) return false;

    const totp = new TOTP({
      issuer: 'SafeCare',
      label: '',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(admin.totpSecret),
    });

    const delta = totp.validate({ token, window: 1 });
    return delta !== null;
  }

  /**
   * Disable TOTP for an admin after verifying their password.
   */
  async disableTotp(adminId: string, password: string): Promise<boolean> {
    const rows = await db
      .select({ passwordHash: adminUsers.passwordHash })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId));

    const admin = rows[0];
    if (!admin) return false;

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return false;

    await db
      .update(adminUsers)
      .set({ totpSecret: null })
      .where(eq(adminUsers.id, adminId));

    return true;
  }

  /**
   * Check if an admin has TOTP enabled.
   */
  async hasTotpEnabled(adminId: string): Promise<boolean> {
    const rows = await db
      .select({ totpSecret: adminUsers.totpSecret })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId));

    const admin = rows[0];
    return admin?.totpSecret != null;
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
