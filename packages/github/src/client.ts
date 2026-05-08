import { Octokit } from "octokit";

export function createGithubClient(token: string) {
  return new Octokit({
    auth: token,
  });
}
