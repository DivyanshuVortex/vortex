import { execSync } from "child_process";
import { AgentTool } from "./tool-types";

/**
 * GrepTool — Searches the local codebase for exact pattern matches.
 *
 * Agents use this to verify their assumptions:
 * - "Does this function actually exist in the codebase?"
 * - "Is this import path correct?"
 * - "Where else is this pattern used?"
 *
 * Uses `grep -rn` for recursive, line-numbered search.
 */
export class GrepTool implements AgentTool {
  name = "grep_search";
  description =
    'Search the local codebase for a text pattern. Args: {"pattern": "search text", "path": "optional subdirectory"}. Returns matching lines with file paths and line numbers.';

  private cwd: string;
  private maxResults: number;

  constructor(cwd?: string, maxResults: number = 20) {
    this.cwd = cwd || process.cwd();
    this.maxResults = maxResults;
  }

  async execute(args: Record<string, string>): Promise<string> {
    const pattern = args.pattern;
    if (!pattern) {
      return "Error: 'pattern' argument is required.";
    }

    const searchPath = args.path || ".";

    try {
      const result = execSync(
        `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" ` +
          `--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git ` +
          `"${pattern.replace(/"/g, '\\"')}" ${searchPath}`,
        {
          cwd: this.cwd,
          encoding: "utf8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "ignore"],
        }
      );

      const lines = result.trim().split("\n").slice(0, this.maxResults);
      if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
        return `No matches found for pattern: "${pattern}"`;
      }

      return `Found ${lines.length} matches for "${pattern}":\n${lines.join("\n")}`;
    } catch (err: any) {
      // grep returns exit code 1 when no matches are found — this is NOT an error
      if (err.status === 1) {
        return `No matches found for pattern: "${pattern}"`;
      }
      return `Error searching for pattern: ${err.message}`;
    }
  }
}
