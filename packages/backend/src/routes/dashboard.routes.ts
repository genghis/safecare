import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, sql, gte, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { recipients, drivers, deliveries } from '../db/schema.js';

export default async function dashboardRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/dashboard/stats
   * Returns KPI stats for the admin dashboard.
   */
  fastify.get(
    '/api/dashboard/stats',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Count all recipients
      const recipientCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipients);

      // Count vetted drivers
      const activeDriverCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(drivers)
        .where(eq(drivers.vettedStatus, 'vetted'));

      // Count today's deliveries (created or delivered today)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);

      const todaysDeliveryCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(deliveries)
        .where(
          and(
            gte(deliveries.createdAt, todayStart),
            lt(deliveries.createdAt, tomorrowStart),
          ),
        );

      // Count pending deliveries
      const pendingCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(deliveries)
        .where(eq(deliveries.status, 'pending'));

      return reply.send({
        success: true,
        data: {
          totalRecipients: recipientCount[0].count,
          activeDrivers: activeDriverCount[0].count,
          todaysDeliveries: todaysDeliveryCount[0].count,
          pendingOrders: pendingCount[0].count,
        },
      });
    },
  );
}
