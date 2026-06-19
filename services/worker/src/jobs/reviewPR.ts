import { IntelligenceAgent, Indexer } from '@vortex/engine';
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
  const indexer = new Indexer();

  try {
    // 1. Fetch the diff
    console.log(`[ReviewPR] Fetching diff for PR #${prNumber}...`);
    const diff = await github.fetchPullRequestDiff(owner, repo, prNumber);

    // 2. Extract search queries and run hybrid search for context
    console.log(`[ReviewPR] Extracting architectural queries from diff...`);
    const queries = await agent.extractSearchQueriesFromDiff(diff);

    const allChunks: any[] = [];
    if (queries.length > 0) {
      console.log(`[ReviewPR] Hybrid searching for: ${queries.join(", ")}...`);
      for (const query of queries) {
        const results = await indexer.hybridSearch(query, 3);
        allChunks.push(...results);
      }
    }

    // Deduplicate chunks by ID
    const uniqueChunks = Array.from(
      new Map(allChunks.map((c) => [c.id, c])).values()
    );

    // 3. Generate multi-agent review (Security + Architecture + Synthesis)
    console.log(`[ReviewPR] Running multi-agent review...`);
    const review = await agent.generateMultiAgentReview(diff, uniqueChunks);

    // 4. TODO: Post the review back to GitHub
    // await github.submitPullRequestReview(owner, repo, prNumber, review.markdownReport);
    
    console.log(`[ReviewPR] Successfully reviewed PR #${prNumber} — Verdict: ${review.verdict}`);
    
    return review; // Result is stored in BullMQ
  } catch (err) {
    console.error(`[ReviewPR] Failed to process review for PR #${prNumber}:`, err);
    throw err;
  }
}
