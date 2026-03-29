import { Queue, Worker } from 'bullmq';
import {
  createPurgeQueue,
  createPurgeWorker,
  scheduleRecurringPurgeJobs,
  queueImmediatePurge,
} from './purge.job.js';
import {
  createTwilioScrubQueue,
  createTwilioScrubWorker,
  scheduleDailySweep,
  queueSessionScrub,
} from './twilio-scrub.job.js';
import {
  createPurgeConfirmQueue,
  createPurgeConfirmWorker,
  schedulePurgeConfirmCheck,
} from './purge-confirm.job.js';

let purgeQueue: Queue | null = null;
let purgeWorker: Worker | null = null;
let twilioScrubQueue: Queue | null = null;
let twilioScrubWorker: Worker | null = null;
let purgeConfirmQueue: Queue | null = null;
let purgeConfirmWorker: Worker | null = null;

/**
 * Initialize all BullMQ queues and workers.
 * Call this once at application startup.
 */
export function initQueues(): void {
  // Purge queue (hourly delivery purge + daily audit cleanup)
  purgeQueue = createPurgeQueue();
  purgeWorker = createPurgeWorker();

  scheduleRecurringPurgeJobs(purgeQueue).catch((err) => {
    console.error('Failed to schedule recurring purge jobs:', err);
  });

  // Twilio scrub queue (session scrub + daily sweep)
  twilioScrubQueue = createTwilioScrubQueue();
  twilioScrubWorker = createTwilioScrubWorker();

  scheduleDailySweep(twilioScrubQueue).catch((err) => {
    console.error('Failed to schedule Twilio daily sweep:', err);
  });

  // Purge confirmation queue (hourly check for unconfirmed purges)
  purgeConfirmQueue = createPurgeConfirmQueue();
  purgeConfirmWorker = createPurgeConfirmWorker();

  schedulePurgeConfirmCheck(purgeConfirmQueue).catch((err) => {
    console.error('Failed to schedule purge confirmation check:', err);
  });

  console.log('BullMQ queues and workers initialized');
}

/**
 * Gracefully close all queues and workers.
 * Call this during application shutdown.
 */
export async function closeQueues(): Promise<void> {
  const workers = [purgeWorker, twilioScrubWorker, purgeConfirmWorker];
  const queues = [purgeQueue, twilioScrubQueue, purgeConfirmQueue];

  for (const worker of workers) {
    if (worker) {
      await worker.close();
    }
  }

  for (const queue of queues) {
    if (queue) {
      await queue.close();
    }
  }

  purgeWorker = null;
  purgeQueue = null;
  twilioScrubWorker = null;
  twilioScrubQueue = null;
  purgeConfirmWorker = null;
  purgeConfirmQueue = null;

  console.log('BullMQ queues and workers closed');
}

/**
 * Get the purge queue instance (for enqueuing immediate purge jobs).
 */
export function getPurgeQueue(): Queue {
  if (!purgeQueue) {
    throw new Error('Purge queue not initialized. Call initQueues() first.');
  }
  return purgeQueue;
}

/**
 * Get the Twilio scrub queue instance (for enqueuing session scrub jobs).
 */
export function getTwilioScrubQueue(): Queue {
  if (!twilioScrubQueue) {
    throw new Error(
      'Twilio scrub queue not initialized. Call initQueues() first.',
    );
  }
  return twilioScrubQueue;
}

export { queueImmediatePurge, queueSessionScrub };
