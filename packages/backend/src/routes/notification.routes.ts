import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { recipients } from '../db/schema.js';
import { config } from '../config.js';
import {
  notificationService,
  RecipientContact,
} from '../services/notification.service.js';

const testNotificationSchema = z.object({
  recipientId: z.string().uuid(),
  messageKey: z.string().min(1),
});

export default async function notificationRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/notifications/test
   * Send a test notification to a recipient (admin only).
   * Useful for verifying notification delivery is working.
   */
  fastify.post(
    '/api/notifications/test',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = testNotificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { recipientId, messageKey } = parsed.data;

      // Look up recipient with decrypted phone
      const [recipient] = await db
        .select({
          id: recipients.id,
          phone: sql<string>`pgp_sym_decrypt(${recipients.phoneEnc}::bytea, ${config.DEK})`,
          communicationPreference: recipients.communicationPreference,
          language: recipients.language,
          whatsappConsent: recipients.whatsappConsent,
        })
        .from(recipients)
        .where(eq(recipients.id, recipientId));

      if (!recipient) {
        return reply.code(404).send({
          success: false,
          error: 'Recipient not found',
        });
      }

      const contact: RecipientContact = {
        phone: recipient.phone,
        communicationPreference:
          (recipient.communicationPreference as RecipientContact['communicationPreference']) ?? 'sms',
        language: recipient.language ?? undefined,
        whatsappConsent: recipient.whatsappConsent ?? false,
      };

      const result = await notificationService.send(contact, messageKey);

      return reply.send({
        success: true,
        data: result,
      });
    },
  );
}
