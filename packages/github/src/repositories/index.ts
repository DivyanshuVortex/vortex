import { Octokit } from "@octokit/rest";

export interface RepositoryInfo {
  name: string;
  url: string;
  description?: string;
  stars: number;
  language?: string;
}

export async function getRepositoryInfo(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepositoryInfo> {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}",
      {
        owner,
        repo,
      }
    );

    return {
      name: response.data.name,
      url: response.data.html_url,
      description: response.data.description || undefined,
      stars: response.data.stargazers_count,
      language: response.data.language || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch repository info for ${owner}/${repo}: ${message}`
    );
  }
}
