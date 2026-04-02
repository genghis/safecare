import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { recipientService } from '../services/recipient.service.js';
import {
  constantTimeEquals,
  normalizeCommunicationPreference,
  normalizePhone,
  sanitizePlainText,
} from '../utils/security.js';

const createRecipientSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  phone: z.string().min(10).max(15),
  lat: z.number().optional(),
  lng: z.number().optional(),
  communicationPreference: z.enum(['sms', 'whatsapp', 'signal']).optional(),
  whatsappConsent: z.boolean().optional(),
  language: z.string().min(2).max(5).optional(),
});

const jotformWebhookSchema = z.object({
  rawRequest: z.string().optional(),
  formID: z.string().optional(),
  submissionID: z.string().optional(),
  // JotForm fields - mapped by question name
  q3_fullName: z.string().optional(),
  q4_address: z.string().optional(),
  q5_phoneNumber: z.string().optional(),
  q6_communicationPreference: z.string().optional(),
}).passthrough();

export default async function recipientRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/recipients
   * List all recipients (admin only). Decrypts PII.
   */
  fastify.get(
    '/api/recipients',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const recipients = await recipientService.list();
      return reply.send({ success: true, data: recipients });
    },
  );

  /**
   * GET /api/recipients/:id
   * Get a single recipient by id (admin only).
   */
  fastify.get(
    '/api/recipients/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const recipient = await recipientService.findById(id);

      if (!recipient) {
        return reply.code(404).send({
          success: false,
          error: 'Recipient not found',
        });
      }

      return reply.send({ success: true, data: recipient });
    },
  );

  /**
   * POST /api/recipients
   * Create a new recipient (admin only).
   */
  fastify.post(
    '/api/recipients',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createRecipientSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const sanitized = {
        ...parsed.data,
        name: sanitizePlainText(parsed.data.name),
        address: sanitizePlainText(parsed.data.address),
        phone: normalizePhone(parsed.data.phone),
        language: parsed.data.language
          ? sanitizePlainText(parsed.data.language)
          : undefined,
      };

      // Check for duplicate phone
      const existing = await recipientService.findByPhone(sanitized.phone);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: 'A recipient with this phone number already exists',
        });
      }

      const id = await recipientService.create(sanitized);

      return reply.code(201).send({
        success: true,
        data: { id },
      });
    },
  );

  /**
   * POST /api/webhooks/jotform
   * JotForm webhook intake. Validates payload and creates a recipient.
   */
  fastify.post(
    '/api/webhooks/jotform',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!config.JOTFORM_API_KEY) {
        return reply.code(503).send({
          success: false,
          error: 'JotForm webhook is not configured',
        });
      }

      const providedKey =
        (request.headers['x-safecare-webhook-key'] as string | undefined) ??
        ((request.query as Record<string, string | undefined>)?.apiKey ?? '');

      if (!providedKey || !constantTimeEquals(providedKey, config.JOTFORM_API_KEY)) {
        fastify.log.warn('Rejected JotForm webhook with invalid shared secret');
        return reply.code(403).send({
          success: false,
          error: 'Invalid webhook signature',
        });
      }

      const parsed = jotformWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid JotForm payload',
          details: parsed.error.issues,
        });
      }

      const body = parsed.data as Record<string, any>;

      // Extract fields from JotForm payload
      const name = sanitizePlainText(body.q3_fullName || body['q3_fullName'] || '');
      const address = sanitizePlainText(body.q4_address || body['q4_address'] || '');
      const phone = normalizePhone(body.q5_phoneNumber || body['q5_phoneNumber'] || '');
      const commPref = normalizeCommunicationPreference(
        body.q6_communicationPreference || body['q6_communicationPreference'],
      );

      if (!name || !address || !phone) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required JotForm fields (name, address, phone)',
        });
      }

      // Check for duplicate
      const existing = await recipientService.findByPhone(phone);
      if (existing) {
        fastify.log.info('JotForm webhook: duplicate recipient ignored');
        return reply.send({ success: true, data: { id: existing.id, duplicate: true } });
      }

      const id = await recipientService.create({
        name,
        address,
        phone,
        communicationPreference: commPref,
      });

      fastify.log.info(`JotForm webhook: created recipient ${id}`);

      return reply.code(201).send({
        success: true,
        data: { id },
      });
    },
  );
}
