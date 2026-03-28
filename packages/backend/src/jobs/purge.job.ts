import { Queue, Worker, Job } from 'bullmq';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deliveries, auditLog } from '../db/schema.js';
import { config } from '../config.js';
import { MAX_DELIVERY_RETENTION_HOURS } from '@safecare/shared';

const QUEUE_NAME = 'purge';

const connection = {
  host: new URL(config.REDIS_URL).hostname || 'localhost',
  port: parseInt(new URL(config.REDIS_URL).port || '6379', 10),
};

/**
 * Create the purge queue for scheduling data retention jobs.
 */
export function createPurgeQueue(): Queue {
  const queue = new Queue(QUEUE_NAME, { connection });
  return queue;
}

/**
 * Schedule the recurring hourly purge job.
 */
export async function scheduleHourlyPurge(queue: Queue): Promise<void> {
  // Remove existing repeatable jobs to avoid duplicates on restart
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    'hourly-purge',
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // every hour
      removeOnComplete: { count: 24 },
      removeOnFail: { count: 48 },
    },
  );
}

/**
 * Queue an immediate purge for a specific delivery after acknowledgment.
 */
export async function queueImmediatePurge(
  queue: Queue,
  deliveryId: string,
): Promise<void> {
  await queue.add(
    'immediate-purge',
    { deliveryId },
    {
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    },
  );
}

/**
 * Create the purge worker that processes purge jobs.
 */
export function createPurgeWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === 'hourly-purge') {
        await processHourlyPurge();
      } else if (job.name === 'immediate-purge') {
        await processImmediatePurge(job.data.deliveryId);
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    console.log(`Purge job ${job.id} (${job.name}) completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Purge job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  return worker;
}

/**
 * Hourly purge: hard-delete deliveries older than the retention window.
 * Creates an audit trail entry before deleting.
 */
async function processHourlyPurge(): Promise<void> {
  const cutoff = new Date(
    Date.now() - MAX_DELIVERY_RETENTION_HOURS * 60 * 60 * 1000,
  );

  // Find deliveries past the retention window
  const expiredDeliveries = await db
    .select({
      id: deliveries.id,
      driverId: deliveries.driverId,
      dispatchSessionId: deliveries.dispatchSessionId,
      status: deliveries.status,
      releasedAt: deliveries.releasedAt,
    })
    .from(deliveries)
    .where(lt(deliveries.createdAt, cutoff));

  if (expiredDeliveries.length === 0) {
    return;
  }

  // Group by driver for audit trail
  const byDriver = new Map<
    string,
    { count: number; completed: number; releasedAt: Date | null }
  >();

  for (const d of expiredDeliveries) {
    const driverId = d.driverId ?? 'unassigned';
    const entry = byDriver.get(driverId) ?? {
      count: 0,
      completed: 0,
      releasedAt: null,
    };
    entry.count++;
    if (d.status === 'delivered' || d.status === 'acknowledged') {
      entry.completed++;
    }
    if (d.releasedAt && !entry.releasedAt) {
      entry.releasedAt = d.releasedAt;
    }
    byDriver.set(driverId, entry);
  }

  // Create audit trail entries
  for (const [driverId, stats] of byDriver) {
    await db.insert(auditLog).values({
      driverId: driverId === 'unassigned' ? null : driverId,
      action: 'hourly_purge',
      stopCount: stats.count,
      completedCount: stats.completed,
      releasedAt: stats.releasedAt,
      purgedAt: new Date(),
    });
  }

  // Hard-delete the expired deliveries
  const ids = expiredDeliveries.map((d) => d.id);
  for (const id of ids) {
    await db.delete(deliveries).where(eq(deliveries.id, id));
  }

  console.log(
    `Hourly purge: deleted ${ids.length} deliveries older than ${MAX_DELIVERY_RETENTION_HOURS}h`,
  );
}

/**
 * Immediate purge: hard-delete a single acknowledged delivery.
 * Creates an audit trail entry before deleting.
 */
async function processImmediatePurge(deliveryId: string): Promise<void> {
  const rows = await db
    .select({
      id: deliveries.id,
      driverId: deliveries.driverId,
      status: deliveries.status,
      releasedAt: deliveries.releasedAt,
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.id, deliveryId),
        eq(deliveries.status, 'acknowledged'),
      ),
    );

  const delivery = rows[0];
  if (!delivery) {
    return; // Already purged or not acknowledged
  }

  // Create audit trail
  await db.insert(auditLog).values({
    driverId: delivery.driverId,
    action: 'immediate_purge',
    stopCount: 1,
    completedCount: 1,
    releasedAt: delivery.releasedAt,
    purgedAt: new Date(),
  });

  // Hard-delete the delivery
  await db.delete(deliveries).where(eq(deliveries.id, deliveryId));

  console.log(`Immediate purge: deleted delivery ${deliveryId}`);
}
