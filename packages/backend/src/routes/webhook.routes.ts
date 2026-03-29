import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deliveries, recipients } from '../db/schema.js';
import { config } from '../config.js';
import { notificationService } from '../services/notification.service.js';
import { queueImmediatePurge } from '../jobs/index.js';
import { getPurgeQueue } from '../jobs/index.js';

const ACK_KEYWORDS = ['got it', 'gotit', 'received', 'yes', 'recibido', 'تم', 'helay', 'recu', '收到'];

export default async function webhookRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/webhooks/twilio/sms
   * Inbound SMS webhook from Twilio. No auth (validated by Twilio signature).
   * Handles recipient delivery acknowledgments.
   */
  fastify.post(
    '/api/webhooks/twilio/sms',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const from = body.From || '';
      const messageBody = (body.Body || '').trim().toLowerCase();

      fastify.log.info(`Inbound SMS from ${from}: "${messageBody}"`);

      // Check if this is an ack keyword
      const isAck = ACK_KEYWORDS.some((kw) => messageBody.includes(kw));

      if (isAck && from) {
        try {
          // Look up recipient by phone hash
          const recipientRows = await db
            .select({
              id: recipients.id,
              phoneEnc: recipients.phoneEnc,
              communicationPreference: recipients.communicationPreference,
              language: recipients.language,
            })
            .from(recipients)
            .where(
              eq(
                recipients.phoneHash,
                sql`encode(hmac(${from}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
              ),
            );

          const recipient = recipientRows[0];
          if (recipient) {
            // Find their most recent delivered (unacknowledged) delivery
            const deliveryRows = await db
              .select({ id: deliveries.id })
              .from(deliveries)
              .where(
                and(
                  eq(deliveries.recipientId, recipient.id),
                  eq(deliveries.status, 'delivered'),
                ),
              );

            const delivery = deliveryRows[0];
            if (delivery) {
              // Mark as acknowledged
              await db
                .update(deliveries)
                .set({
                  status: 'acknowledged',
                  acknowledgedAt: new Date(),
                })
                .where(eq(deliveries.id, delivery.id));

              // Send confirmation
              const phone = await db
                .select({
                  phone: sql<string>`pgp_sym_decrypt(${recipients.phoneEnc}::bytea, ${config.DEK})`,
                })
                .from(recipients)
                .where(eq(recipients.id, recipient.id));

              if (phone[0]) {
                notificationService
                  .send(
                    {
                      phone: phone[0].phone,
                      communicationPreference: (recipient.communicationPreference as any) || 'sms',
                      language: (recipient as any).language || 'en',
                    },
                    'notification.delivery.ackConfirmed',
                  )
                  .catch((err) =>
                    fastify.log.error(err, 'Failed to send ack confirmation'),
                  );
              }

              // Queue immediate purge
              try {
                const purgeQueue = getPurgeQueue();
                await queueImmediatePurge(purgeQueue, delivery.id);
              } catch {
                // Queue not ready, will be caught by hourly sweep
              }

              fastify.log.info(
                `Delivery ${delivery.id} acknowledged by recipient ${recipient.id}`,
              );
            }
          }
        } catch (err) {
          fastify.log.error(err, 'Error processing SMS ack');
        }
      }

      // Return empty TwiML response
      reply.type('text/xml');
      return reply.send('<Response></Response>');
    },
  );
}
