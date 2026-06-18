import { Octokit } from "@octokit/rest";

export interface PullRequestReview {
  id: number;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  author: string;
  body?: string;
  submittedAt?: string;
}

export async function getPullRequestReviews(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PullRequestReview[]> {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: prNumber,
      }
    );

    return response.data.map((review: any) => ({
      id: review.id,
      state: review.state,
      author: review.user.login,
      body: review.body || undefined,
      submittedAt: review.submitted_at || undefined,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch reviews for PR #${prNumber} in ${owner}/${repo}: ${message}`
    );
  }
}

export async function submitPullRequestReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "COMMENT"
): Promise<void> {
  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: prNumber,
        body,
        event,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to submit review for PR #${prNumber} in ${owner}/${repo}: ${message}`
    );
  }
}
