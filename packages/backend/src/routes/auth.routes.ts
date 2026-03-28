import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';

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
}
