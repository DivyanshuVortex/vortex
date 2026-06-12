import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Singleton Redis connections for BullMQ
// BullMQ requires separate connections for workers, queues, and events
export const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const connectionForQueue = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
  console.error('[Redis Worker Connection Error]', err);
});
