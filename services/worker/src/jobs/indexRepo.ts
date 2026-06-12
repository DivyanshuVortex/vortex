import { Indexer } from '@vortex/engine';
import { Job } from 'bullmq';

export interface IndexRepoJobData {
  owner: string;
  repo: string;
  path: string; // The local path to index
}

export default async function handleIndexRepo(job: Job<IndexRepoJobData>) {
  const { owner, repo, path } = job.data;
  console.log(`[IndexRepo] Started indexing for ${owner}/${repo} at ${path}`);

  const indexer = new Indexer();
  
  // Here we would typically clone the repo or ensure it's up to date.
  // For now, we assume the path exists and is ready to index.
  
  try {
    await indexer.indexRepository(path);
    console.log(`[IndexRepo] Successfully indexed ${owner}/${repo}`);
  } catch (err) {
    console.error(`[IndexRepo] Failed to index ${owner}/${repo}:`, err);
    throw err; // Throw so BullMQ can handle retries and mark as failed
  }
}
