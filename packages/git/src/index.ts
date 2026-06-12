import { execSync } from "child_process";
import * as path from "path";

/**
 * Executes a git command in the specified directory.
 */
function runGitCmd(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (error) {
    throw new Error(`Git command failed: git ${cmd} in ${cwd}`);
  }
}

/**
 * Checks if the given path is inside a git repository.
 */
export function isGitRepo(cwd: string): boolean {
  try {
    runGitCmd("rev-parse --is-inside-work-tree", cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the absolute path to the root of the git repository.
 */
export function getGitRoot(cwd: string): string {
  return runGitCmd("rev-parse --show-toplevel", cwd);
}

/**
 * Lists all tracked files in the git repository.
 * Returns absolute paths.
 */
export function listTrackedFiles(cwd: string): string[] {
  const root = getGitRoot(cwd);
  const output = runGitCmd("ls-files", root);
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((file) => path.join(root, file));
}

/**
 * Retrieves the latest commit hash for a specific file or the repository.
 */
export function getLatestCommitHash(cwd: string, filePath?: string): string {
  if (filePath) {
    return runGitCmd(`log -n 1 --pretty=format:%H -- "${filePath}"`, cwd);
  }
  return runGitCmd("rev-parse HEAD", cwd);
}

/**
 * Retrieves the latest commit date (UNIX timestamp) for a specific file.
 */
export function getLatestCommitTimestamp(cwd: string, filePath?: string): number {
  const cmd = filePath 
    ? `log -n 1 --pretty=format:%ct -- "${filePath}"`
    : `log -n 1 --pretty=format:%ct`;
  const output = runGitCmd(cmd, cwd);
  return parseInt(output, 10);
}

/**
 * Extracts the GitHub owner and repo name from the local git remote.
 */
export function getGithubRepoInfo(cwd: string): { owner: string; repo: string } | null {
  try {
    const remoteUrl = runGitCmd("remote get-url origin", cwd);
    // Matches: git@github.com:owner/repo.git OR https://github.com/owner/repo.git
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^.]+)/);
    if (match && match.length >= 3) {
      return { owner: match[1]!, repo: match[2]! };
    }
    return null;
  } catch {
    return null;
  }
}

