import { Queue, Worker } from 'bullmq';
import {
  createPurgeQueue,
  createPurgeWorker,
  scheduleHourlyPurge,
  queueImmediatePurge,
} from './purge.job.js';

let purgeQueue: Queue | null = null;
let purgeWorker: Worker | null = null;

/**
 * Initialize all BullMQ queues and workers.
 * Call this once at application startup.
 */
export function initQueues(): void {
  purgeQueue = createPurgeQueue();
  purgeWorker = createPurgeWorker();

  // Schedule the recurring hourly purge job
  scheduleHourlyPurge(purgeQueue).catch((err) => {
    console.error('Failed to schedule hourly purge job:', err);
  });

  console.log('BullMQ queues and workers initialized');
}

/**
 * Gracefully close all queues and workers.
 * Call this during application shutdown.
 */
export async function closeQueues(): Promise<void> {
  if (purgeWorker) {
    await purgeWorker.close();
    purgeWorker = null;
  }
  if (purgeQueue) {
    await purgeQueue.close();
    purgeQueue = null;
  }

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

export { queueImmediatePurge };
