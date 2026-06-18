import { Octokit } from "@octokit/rest";

export interface ContributorInfo {
  login: string;
  contributions: number;
  avatarUrl?: string;
}

export async function getRepositoryContributors(
  octokit: Octokit,
  owner: string,
  repo: string,
  limit: number = 10
): Promise<ContributorInfo[]> {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/contributors",
      {
        owner,
        repo,
        per_page: limit,
      }
    );

    return response.data.map((contributor: any) => ({
      login: contributor.login,
      contributions: contributor.contributions,
      avatarUrl: contributor.avatar_url,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch contributors for ${owner}/${repo}: ${message}`
    );
  }
}
