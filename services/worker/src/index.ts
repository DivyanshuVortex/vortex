import { Worker, Job } from 'bullmq';
import { connection } from './redis';
import handleIndexRepo from './jobs/indexRepo';
import handleReviewPR from './jobs/reviewPR';

/**
 * VORTEX CLOUD WORKER
 * 
 * Note: This service is exclusively for running Vortex as a backend API/Server 
 * (e.g. for handling GitHub webhooks, asynchronous jobs, etc).
 * 
 * It is NOT used by the local CLI (`vortex init` or `vortex solve`). The CLI 
 * bypasses this worker and Redis entirely to run tasks synchronously.
 */
const QUEUE_NAME = 'vortex-jobs';

console.log(`Starting Vortex Worker... Listening on queue: ${QUEUE_NAME}`);


const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    switch (job.name) {
      case 'IndexRepository':
        return handleIndexRepo(job);
      case 'ReviewPullRequest':
        return handleReviewPR(job);
      default:
        console.warn(`[Worker] Unknown job type received: ${job.name}`);
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 5, // Process up to 5 jobs concurrently
  }
);

// Worker Events
worker.on('completed', (job: Job) => {
  console.log(`[Job Completed] ${job.name} (ID: ${job.id})`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  if (job) {
    console.error(`[Job Failed] ${job.name} (ID: ${job.id}) - ${err.message}`);
  } else {
    console.error(`[Job Failed] Unknown job - ${err.message}`);
  }
});

worker.on('error', (err: Error) => {
  console.error(`[Worker Error] ${err.message}`);
});


async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, starting graceful shutdown...`);
  

  try {
    await worker.close();
    console.log('Worker closed gracefully. All active jobs finished.');
    process.exit(0);
  } catch (err) {
    console.error('Error during worker shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
