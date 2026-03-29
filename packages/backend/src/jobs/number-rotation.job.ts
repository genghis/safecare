import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config.js';
import { NUMBER_ROTATION_DAYS } from '@safecare/shared';
import IORedis from 'ioredis';

const QUEUE_NAME = 'number-rotation';
const REDIS_KEY = 'twilio:rotation-due';
const REDIS_ACTIVATED_KEY = 'twilio:numbers-activated-at';

const connection = {
  host: new URL(config.REDIS_URL).hostname || 'localhost',
  port: parseInt(new URL(config.REDIS_URL).port || '6379', 10),
};

export function createNumberRotationQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection });
}

export async function scheduleNumberRotationCheck(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    'rotation-check',
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // daily
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
}

export function createNumberRotationWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === 'rotation-check') {
        await processRotationCheck();
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('completed', (job) => {
    console.log(`Number rotation check ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Number rotation check ${job?.id} failed:`, err.message);
  });

  return worker;
}

async function processRotationCheck(): Promise<void> {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
    return; // Twilio not configured
  }

  const redis = new IORedis(config.REDIS_URL);

  // Get or set activation date
  let activatedAt = await redis.get(REDIS_ACTIVATED_KEY);
  if (!activatedAt) {
    activatedAt = new Date().toISOString();
    await redis.set(REDIS_ACTIVATED_KEY, activatedAt);
  }

  const activatedDate = new Date(activatedAt);
  const daysSinceActivation = Math.floor(
    (Date.now() - activatedDate.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (daysSinceActivation >= NUMBER_ROTATION_DAYS) {
    await redis.set(REDIS_KEY, new Date().toISOString());
    console.log(
      `WARNING: Twilio number rotation due. Numbers active for ${daysSinceActivation} days (limit: ${NUMBER_ROTATION_DAYS}).`,
    );
  } else {
    await redis.del(REDIS_KEY);
    console.log(
      `Number rotation check: ${daysSinceActivation}/${NUMBER_ROTATION_DAYS} days. No rotation needed.`,
    );
  }

  await redis.quit();
}
