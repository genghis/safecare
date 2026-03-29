import { Queue, Worker, Job } from 'bullmq';
import { and, isNull, isNotNull, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { driverCheckIns } from '../db/schema.js';
import { config } from '../config.js';
import { DEFAULT_PURGE_CONFIRMATION_WINDOW_HOURS } from '@safecare/shared';

const QUEUE_NAME = 'purge-confirm';
const REDIS_UNCONFIRMED_SET = 'purge:unconfirmed';

const connection = {
  host: new URL(config.REDIS_URL).hostname || 'localhost',
  port: parseInt(new URL(config.REDIS_URL).port || '6379', 10),
};

/**
 * Create the purge confirmation queue.
 */
export function createPurgeConfirmQueue(): Queue {
  const queue = new Queue(QUEUE_NAME, { connection });
  return queue;
}

/**
 * Schedule the recurring hourly purge confirmation check.
 */
export async function schedulePurgeConfirmCheck(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    'purge-confirm-check',
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // every hour
      removeOnComplete: { count: 24 },
      removeOnFail: { count: 48 },
    },
  );
}

/**
 * Find drivers who haven't confirmed route data purge within the window.
 */
async function processConfirmCheck(redisConnection: {
  host: string;
  port: number;
}): Promise<void> {
  const cutoff = new Date(
    Date.now() -
      DEFAULT_PURGE_CONFIRMATION_WINDOW_HOURS * 60 * 60 * 1000,
  );

  // Find check-ins where route was released, purge not confirmed,
  // and release happened before the confirmation window cutoff
  const unconfirmed = await db
    .select({
      id: driverCheckIns.id,
      driverId: driverCheckIns.driverId,
      routeReleasedAt: driverCheckIns.routeReleasedAt,
    })
    .from(driverCheckIns)
    .where(
      and(
        isNotNull(driverCheckIns.routeReleasedAt),
        isNull(driverCheckIns.purgeConfirmedAt),
        lt(driverCheckIns.routeReleasedAt, cutoff),
      ),
    );

  // Use ioredis for set operations
  const { default: IORedis } = await import('ioredis');
  const redis = new IORedis(redisConnection.port, redisConnection.host);

  try {
    // Clear the set and repopulate with current unconfirmed driver IDs
    await redis.del(REDIS_UNCONFIRMED_SET);

    if (unconfirmed.length === 0) {
      console.log('Purge confirm check: all drivers have confirmed purge');
      return;
    }

    const driverIds = unconfirmed.map((row) => row.driverId);
    await redis.sadd(REDIS_UNCONFIRMED_SET, ...driverIds);

    for (const row of unconfirmed) {
      console.warn(
        `Driver ${row.driverId} has not confirmed route data purge. Route released at ${row.routeReleasedAt?.toISOString()}`,
      );
    }

    console.log(
      `Purge confirm check: ${unconfirmed.length} driver(s) with unconfirmed purge`,
    );
  } finally {
    await redis.quit();
  }
}

/**
 * Create the purge confirmation worker.
 */
export function createPurgeConfirmWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      await processConfirmCheck(connection);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    console.log(`Purge confirm job ${job.id} (${job.name}) completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `Purge confirm job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });

  return worker;
}
