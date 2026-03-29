import { Queue, Worker, Job } from 'bullmq';
import { and, eq, lt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deliveries, recipients } from '../db/schema.js';
import { config } from '../config.js';
import { ORPHANED_FOOD_ALERT_MINUTES } from '@safecare/shared';
import IORedis from 'ioredis';

const QUEUE_NAME = 'orphaned-food';
const REDIS_KEY = 'alerts:orphaned-food';

const connection = {
  host: new URL(config.REDIS_URL).hostname || 'localhost',
  port: parseInt(new URL(config.REDIS_URL).port || '6379', 10),
};

export function createOrphanedFoodQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection });
}

export async function scheduleOrphanedFoodCheck(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    'orphaned-food-check',
    {},
    {
      repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  );
}

export function createOrphanedFoodWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === 'orphaned-food-check') {
        await processOrphanedFoodCheck();
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('completed', (job) => {
    console.log(`Orphaned food check ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Orphaned food check ${job?.id} failed:`, err.message);
  });

  return worker;
}

async function processOrphanedFoodCheck(): Promise<void> {
  const cutoff = new Date(
    Date.now() - ORPHANED_FOOD_ALERT_MINUTES * 60 * 1000,
  );

  const orphaned = await db
    .select({
      id: deliveries.id,
      recipientId: deliveries.recipientId,
      recipientName: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
      address: sql<string>`pgp_sym_decrypt(${deliveries.addressEnc}::bytea, ${config.DEK})`,
      driverId: deliveries.driverId,
      deliveredAt: deliveries.deliveredAt,
    })
    .from(deliveries)
    .leftJoin(recipients, eq(deliveries.recipientId, recipients.id))
    .where(
      and(
        eq(deliveries.status, 'delivered'),
        isNull(deliveries.acknowledgedAt),
        lt(deliveries.deliveredAt, cutoff),
      ),
    );

  if (orphaned.length === 0) return;

  // Store in Redis for dashboard
  const redis = new IORedis(config.REDIS_URL);
  await redis.del(REDIS_KEY);
  for (const d of orphaned) {
    await redis.sadd(REDIS_KEY, d.id);
  }
  await redis.quit();

  console.log(
    `Orphaned food alert: ${orphaned.length} delivery(ies) unconfirmed after ${ORPHANED_FOOD_ALERT_MINUTES} minutes`,
  );
}
