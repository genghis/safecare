import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
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

      // In production, OTP is sent via SMS/WhatsApp and not returned in response.
      // For development, we include it in the response.
      const responseData: Record<string, any> = { sent: true };
      if (process.env.NODE_ENV !== 'production') {
        responseData.otp = otp;
      }

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
      const enabled = await authService.enableTotp(adminId, secret, token);

      if (!enabled) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid verification code. Please try again.',
        });
      }

      return reply.send({
        success: true,
        data: { enabled: true },
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
