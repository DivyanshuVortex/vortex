import { Octokit } from "@octokit/rest";

export interface GetPullRequestParams {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
}

export async function getPullRequestMetadata({
  octokit,
  owner,
  repo,
  pullNumber,
}: GetPullRequestParams) {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: pullNumber,
      }
    );

    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch PR #${pullNumber} from ${owner}/${repo}: ${message}`
    );
  }
}

export async function getPullRequestDiff({
  octokit,
  owner,
  repo,
  pullNumber,
}: GetPullRequestParams): Promise<string> {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: pullNumber,
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
      }
    );

    return response.data as unknown as string;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch diff for PR #${pullNumber} from ${owner}/${repo}: ${message}`
    );
  }
}