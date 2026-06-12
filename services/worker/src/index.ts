import { Worker, Job } from 'bullmq';
import { connection } from './redis';
import handleIndexRepo from './jobs/indexRepo';
import handleReviewPR from './jobs/reviewPR';

const QUEUE_NAME = 'vortex-jobs';

console.log(`🚀 Starting Vortex Worker... Listening on queue: ${QUEUE_NAME}`);

// Create the BullMQ Worker
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
  console.log(`✅ [Job Completed] ${job.name} (ID: ${job.id})`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  if (job) {
    console.error(`❌ [Job Failed] ${job.name} (ID: ${job.id}) - ${err.message}`);
  } else {
    console.error(`❌ [Job Failed] Unknown job - ${err.message}`);
  }
});

worker.on('error', (err: Error) => {
  console.error(`[Worker Error] ${err.message}`);
});

// Graceful Shutdown Handler
// This ensures that if the server is restarted or crashes,
// active AI processing jobs are given time to finish safely.
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  
  // Pause worker so it stops accepting new jobs from Redis
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
