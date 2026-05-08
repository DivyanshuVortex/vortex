import { Octokit } from "octokit";
import { getPullRequestMetadata, getPullRequestDiff } from "./pull-requests/get-pr";
import { createGithubClient } from "./client";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("Missing GITHUB_TOKEN in environment variables");
  }

  const octokit = createGithubClient(token);

  try {
    const pr = await getPullRequestMetadata({
      octokit,
      owner: "microcks",
      repo: "microcks-cli",
      pullNumber: 120,
    });

    console.log("--- PR Metadata ---");
    console.log({
      title: pr.title,
      state: pr.state,
      author: pr.user?.login,
    });

    console.log("\n--- PR Diff ---");
    const diff = await getPullRequestDiff({
      octokit,
      owner: "microcks",
      repo: "microcks-cli",
      pullNumber: 120,
    });
    
    // Print first 500 characters of the diff
    console.log(diff.substring(0, 500) + (diff.length > 500 ? "..." : ""));

  } catch (error) {
    console.error("Error fetching PR data:", error instanceof Error ? error.message : error);
  }
}

main();
