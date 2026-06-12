import { IntelligenceAgent } from '@vortex/engine';
import { createGithubClient } from '@vortex/github';
import { Job } from 'bullmq';

export interface ReviewPRJobData {
  owner: string;
  repo: string;
  prNumber: number;
}

export default async function handleReviewPR(job: Job<ReviewPRJobData>) {
  const { owner, repo, prNumber } = job.data;
  console.log(`[ReviewPR] Started review for ${owner}/${repo}#${prNumber}`);

  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is missing in environment");
  }

  const github = createGithubClient(process.env.GITHUB_TOKEN);
  const agent = new IntelligenceAgent();

  try {
    // 1. Fetch the diff
    console.log(`[ReviewPR] Fetching diff for PR #${prNumber}...`);
    const diff = await github.fetchPullRequestDiff(owner, repo, prNumber);

    // 2. Generate the review
    console.log(`[ReviewPR] Generating AI review...`);
    const review = await agent.generateReview(diff);

    // 3. Optional: Post the review back to GitHub (Not implemented yet, just logging)
    // await github.postPullRequestReview(owner, repo, prNumber, review);
    
    console.log(`[ReviewPR] Successfully generated review for PR #${prNumber}`);
    
    return review; // Result is stored in BullMQ
  } catch (err) {
    console.error(`[ReviewPR] Failed to process review for PR #${prNumber}:`, err);
    throw err;
  }
}
