import { Octokit } from "@octokit/rest";

export class GithubClient {
  private octokit: Octokit;

  constructor(token?: string) {
    this.octokit = token ? new Octokit({ auth: token }) : new Octokit();
  }

  /**
   * Fetches the raw diff of a Pull Request.
   */
  async fetchPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: {
        format: "diff",
      },
    });
    return data as unknown as string;
  }

  /**
   * Fetches review comments on a Pull Request.
   */
  async fetchPullRequestComments(owner: string, repo: string, prNumber: number): Promise<any[]> {
    const { data } = await this.octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
    });
    return data;
  }

  /**
   * Fetches details of a specific GitHub Issue.
   */
  async fetchIssue(owner: string, repo: string, issueNumber: number): Promise<any> {
    const { data } = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return data;
  }

  /**
   * Fetches all comments on a specific GitHub Issue.
   */
  async fetchIssueComments(owner: string, repo: string, issueNumber: number): Promise<any[]> {
    const { data } = await this.octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return data;
  }
}

export function createGithubClient(token?: string) {
  return new GithubClient(token);
}
