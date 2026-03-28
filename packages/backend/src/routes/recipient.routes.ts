import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { recipientService } from '../services/recipient.service.js';

const createRecipientSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  phone: z.string().min(10).max(15),
  lat: z.number().optional(),
  lng: z.number().optional(),
  communicationPreference: z.enum(['sms', 'whatsapp']).optional(),
  whatsappConsent: z.boolean().optional(),
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
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
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

      // Check for duplicate phone
      const existing = await recipientService.findByPhone(parsed.data.phone);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: 'A recipient with this phone number already exists',
        });
      }

      const id = await recipientService.create(parsed.data);

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
      const body = request.body as Record<string, any>;

      // Extract fields from JotForm payload
      const name = body.q3_fullName || body['q3_fullName'] || '';
      const address = body.q4_address || body['q4_address'] || '';
      const phone = body.q5_phoneNumber || body['q5_phoneNumber'] || '';
      const commPref = body.q6_communicationPreference || 'sms';

      if (!name || !address || !phone) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required JotForm fields (name, address, phone)',
        });
      }

      // Check for duplicate
      const existing = await recipientService.findByPhone(phone);
      if (existing) {
        fastify.log.info(
          `JotForm webhook: recipient with phone already exists, skipping`,
        );
        return reply.send({ success: true, data: { id: existing.id, duplicate: true } });
      }

      const id = await recipientService.create({
        name,
        address,
        phone,
        communicationPreference: commPref === 'whatsapp' ? 'whatsapp' : 'sms',
      });

      fastify.log.info(`JotForm webhook: created recipient ${id}`);

      return reply.code(201).send({
        success: true,
        data: { id },
      });
    },
  );
}
