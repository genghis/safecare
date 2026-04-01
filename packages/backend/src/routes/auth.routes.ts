import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { logAdminAction } from '../services/audit.service.js';
import { db } from '../db/index.js';
import { adminUsers } from '../db/schema.js';

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const adminRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const requestOtpSchema = z.object({
  phone: z.string().min(10).max(15),
});

const verifyOtpSchema = z.object({
  phone: z.string().min(10).max(15),
  otp: z.string().length(6),
});

const totpVerifyLoginSchema = z.object({
  tempToken: z.string().min(1),
  totpCode: z.string().length(6),
});

const totpEnableSchema = z.object({
  secret: z.string().min(1),
  token: z.string().length(6),
});

const totpDisableSchema = z.object({
  password: z.string().min(8),
});

export default async function authRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/auth/admin/login
   * Authenticate an admin user with email + password.
   */
  fastify.post(
    '/api/auth/admin/login',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adminLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { email, password } = parsed.data;
      const result = await authService.loginAdmin(
        email,
        password,
        (payload, options) => fastify.jwt.sign(payload as any, options as any),
      );

      if (!result) {
        logAdminAction('admin_login_failed', request, { email });
        return reply.code(401).send({
          success: false,
          error: 'Invalid email or password',
        });
      }

      // If TOTP is required, return the temp token instead of the JWT
      if ('requiresTotp' in result) {
        return reply.send({
          success: true,
          data: { requiresTotp: true, tempToken: result.tempToken },
        });
      }

      logAdminAction('admin_login', request, { email });

      return reply.send({
        success: true,
        data: result,
      });
    },
  );

  /**
   * POST /api/auth/admin/register
   * Register the first admin user. Only works if no admins exist.
   */
  fastify.post(
    '/api/auth/admin/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adminRegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const exists = await authService.adminExists();
      if (exists) {
        return reply.code(403).send({
          success: false,
          error: 'Admin registration is disabled after the first admin is created',
        });
      }

      const { email, password } = parsed.data;
      const admin = await authService.createAdmin(email, password);

      return reply.code(201).send({
        success: true,
        data: admin,
      });
    },
  );

  /**
   * POST /api/auth/driver/request-otp
   * Request a one-time password sent via SMS to a driver's phone.
   */
  fastify.post(
    '/api/auth/driver/request-otp',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = requestOtpSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { phone } = parsed.data;
      const otp = await authService.driverRequestOTP(phone);

      // Send OTP via configured notification channels
      // TODO: actually send via SMS/Signal when configured
      // For now, always return OTP in response for testing
      const responseData: Record<string, any> = { sent: true, otp };

      return reply.send({
        success: true,
        data: responseData,
      });
    },
  );

  /**
   * POST /api/auth/driver/verify-otp
   * Verify an OTP and receive a driver JWT.
   */
  fastify.post(
    '/api/auth/driver/verify-otp',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = verifyOtpSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { phone, otp } = parsed.data;
      const result = await authService.driverVerifyOTP(
        phone,
        otp,
        (payload, options) => fastify.jwt.sign(payload as any, options as any),
      );

      if (!result) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid or expired OTP',
        });
      }

      return reply.send({
        success: true,
        data: result,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  /**
   * POST /api/auth/admin/logout
   * Revoke the current admin session.
   */
  fastify.post(
    '/api/auth/admin/logout',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const jti = request.user.jti;
      if (jti) {
        const { revokeSession } = await import('../middleware/auth.js');
        await revokeSession(jti);
      }
      logAdminAction('admin_logout', request);
      return reply.send({ success: true, data: { loggedOut: true } });
    },
  );

  /**
   * POST /api/auth/admin/change-password
   * Change the admin's password. Requires current password. Revokes all sessions.
   */
  fastify.post(
    '/api/auth/admin/change-password',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = z
        .object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Current password and new password (8+ chars) required',
        });
      }

      const { currentPassword, newPassword } = parsed.data;
      const changed = await authService.changePassword(
        request.user.sub,
        currentPassword,
        newPassword,
      );

      if (!changed) {
        logAdminAction('admin_login_failed', request, { action: 'password_change' });
        return reply.code(401).send({
          success: false,
          error: 'Current password is incorrect',
        });
      }

      logAdminAction('admin_logout', request, { action: 'password_changed_all_sessions_revoked' });

      return reply.send({
        success: true,
        data: { changed: true, sessionsRevoked: true },
      });
    },
  );

  // ---------------------------------------------------------------------------
  // TOTP two-factor authentication endpoints
  // ---------------------------------------------------------------------------

  /**
   * POST /api/auth/admin/verify-totp
   * Verify a TOTP code after login to receive the real JWT.
   */
  fastify.post(
    '/api/auth/admin/verify-totp',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = totpVerifyLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { tempToken, totpCode } = parsed.data;
      const result = await authService.verifyTotpLogin(
        tempToken,
        totpCode,
        (payload, options) => fastify.jwt.sign(payload as any, options as any),
      );

      if (!result) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid or expired TOTP code',
        });
      }

      return reply.send({
        success: true,
        data: result,
      });
    },
  );

  /**
   * POST /api/auth/admin/totp/setup
   * Generate a new TOTP secret for QR code setup. Requires admin auth.
   */
  fastify.post(
    '/api/auth/admin/totp/setup',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub: adminId } = request.user;

      // Get admin email for the TOTP label
      const rows = await db
        .select({ email: adminUsers.email })
        .from(adminUsers)
        .where(eq(adminUsers.id, adminId));

      const email = rows[0]?.email;
      if (!email) {
        return reply.code(404).send({
          success: false,
          error: 'Admin not found',
        });
      }

      const { secret, uri } = authService.generateTotpSecret(email);

      return reply.send({
        success: true,
        data: { secret, uri },
      });
    },
  );

  /**
   * POST /api/auth/admin/totp/enable
   * Verify the TOTP token and enable 2FA for the admin.
   */
  fastify.post(
    '/api/auth/admin/totp/enable',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = totpEnableSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { sub: adminId } = request.user;
      const { secret, token } = parsed.data;
      const result = await authService.enableTotp(adminId, secret, token);

      if (!result) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid verification code. Please try again.',
        });
      }

      logAdminAction('totp_enabled', request);

      return reply.send({
        success: true,
        data: { enabled: true, backupCodes: result.backupCodes },
      });
    },
  );

  /**
   * POST /api/auth/admin/totp/disable
   * Disable 2FA for the admin after verifying their password.
   */
  fastify.post(
    '/api/auth/admin/totp/disable',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = totpDisableSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { sub: adminId } = request.user;
      const { password } = parsed.data;
      const disabled = await authService.disableTotp(adminId, password);

      if (!disabled) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid password',
        });
      }

      logAdminAction('totp_disabled', request);

      return reply.send({
        success: true,
        data: { enabled: false },
      });
    },
  );

  /**
   * GET /api/auth/admin/totp/status
   * Check if the current admin has TOTP enabled.
   */
  fastify.get(
    '/api/auth/admin/totp/status',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub: adminId } = request.user;
      const enabled = await authService.hasTotpEnabled(adminId);

      return reply.send({
        success: true,
        data: { enabled },
      });
    },
  );
}
