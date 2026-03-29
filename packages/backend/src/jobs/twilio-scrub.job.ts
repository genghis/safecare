import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config.js';

const QUEUE_NAME = 'twilio-scrub';
const REDIS_SID_SET = 'twilio:message-sids';

const connection = {
  host: new URL(config.REDIS_URL).hostname || 'localhost',
  port: parseInt(new URL(config.REDIS_URL).port || '6379', 10),
};

/**
 * Create the Twilio scrub queue.
 */
export function createTwilioScrubQueue(): Queue {
  const queue = new Queue(QUEUE_NAME, { connection });
  return queue;
}

/**
 * Schedule the daily sweep at 2 AM (runs every 24 hours).
 */
export async function scheduleDailySweep(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'daily-sweep') {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  await queue.add(
    'daily-sweep',
    {},
    {
      repeat: {
        pattern: '0 2 * * *', // 2 AM daily
      },
      removeOnComplete: { count: 7 },
      removeOnFail: { count: 14 },
    },
  );
}

/**
 * Queue a session scrub job to delete specific Twilio message SIDs.
 */
export async function queueSessionScrub(
  queue: Queue,
  sids: string[],
): Promise<void> {
  await queue.add(
    'session-scrub',
    { sids },
    {
      removeOnComplete: true,
      removeOnFail: { count: 100 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}

/**
 * Delete a single Twilio message by SID via the REST API.
 * Uses basic auth with Account SID and Auth Token.
 */
async function deleteTwilioMessage(sid: string): Promise<boolean> {
  const accountSid = config.TWILIO_ACCOUNT_SID;
  const authToken = config.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return false;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  // 204 = deleted, 404 = already gone (both are success)
  return response.status === 204 || response.status === 404;
}

/**
 * Process a list of SIDs: delete from Twilio, then remove from Redis tracking set.
 */
async function processSids(
  sids: string[],
  redisConnection: { host: string; port: number },
): Promise<void> {
  // Use ioredis directly for set operations (BullMQ uses ioredis under the hood)
  const { default: IORedis } = await import('ioredis');
  const redis = new IORedis(redisConnection.port, redisConnection.host);

  try {
    for (const sid of sids) {
      const deleted = await deleteTwilioMessage(sid);
      if (deleted) {
        await redis.srem(REDIS_SID_SET, sid);
        console.log(`Twilio scrub: deleted message ${sid}`);
      } else {
        console.warn(`Twilio scrub: failed to delete message ${sid}`);
        throw new Error(`Failed to delete Twilio message ${sid}`);
      }
    }
  } finally {
    await redis.quit();
  }
}

/**
 * Daily sweep: find all remaining tracked SIDs in Redis and delete them from Twilio.
 */
async function processDailySweep(redisConnection: {
  host: string;
  port: number;
}): Promise<void> {
  const { default: IORedis } = await import('ioredis');
  const redis = new IORedis(redisConnection.port, redisConnection.host);

  try {
    const sids = await redis.smembers(REDIS_SID_SET);

    if (sids.length === 0) {
      console.log('Twilio daily sweep: no tracked SIDs to clean up');
      return;
    }

    console.log(
      `Twilio daily sweep: found ${sids.length} tracked SIDs to clean up`,
    );

    for (const sid of sids) {
      const deleted = await deleteTwilioMessage(sid);
      if (deleted) {
        await redis.srem(REDIS_SID_SET, sid);
        console.log(`Twilio daily sweep: deleted message ${sid}`);
      } else {
        console.warn(
          `Twilio daily sweep: failed to delete message ${sid}, will retry next sweep`,
        );
      }
    }
  } finally {
    await redis.quit();
  }
}

/**
 * Create the Twilio scrub worker.
 */
export function createTwilioScrubWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const accountSid = config.TWILIO_ACCOUNT_SID;
      const authToken = config.TWILIO_AUTH_TOKEN;

      if (!accountSid || !authToken) {
        console.log(
          'Twilio scrub: skipping — TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not configured',
        );
        return;
      }

      if (job.name === 'session-scrub') {
        const sids: string[] = job.data.sids ?? [];
        if (sids.length === 0) {
          return;
        }
        await processSids(sids, connection);
      } else if (job.name === 'daily-sweep') {
        await processDailySweep(connection);
      }
    },
    {
      connection,
      concurrency: 3,
    },
  );

  worker.on('completed', (job) => {
    console.log(`Twilio scrub job ${job.id} (${job.name}) completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `Twilio scrub job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });

  return worker;
}
