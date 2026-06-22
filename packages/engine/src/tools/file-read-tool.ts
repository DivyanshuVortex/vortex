import * as fs from "fs";
import * as path from "path";
import { AgentTool } from "./tool-types";

/**
 * FileReadTool — Reads a file from the local codebase.
 *
 * Agents use this to inspect files not included in the original context chunks:
 * - "What does the configuration file look like?"
 * - "What other functions are in this module?"
 * - "What does the test file for this module contain?"
 *
 * Security: Restricts reads to the workspace directory only.
 */
export class FileReadTool implements AgentTool {
  name = "read_file";
  description =
    'Read the contents of a file from the codebase. Args: {"path": "relative file path", "startLine": "optional start line", "endLine": "optional end line"}. Returns file contents.';

  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(args: Record<string, string>): Promise<string> {
    const filePath = args.path;
    if (!filePath) {
      return "Error: 'path' argument is required.";
    }

    // Resolve to absolute path within the workspace
    const absolutePath = path.resolve(this.cwd, filePath);

    // Security: prevent path traversal outside the workspace
    if (!absolutePath.startsWith(this.cwd)) {
      return "Error: Cannot read files outside the workspace directory.";
    }

    // Security: block sensitive files but allow examples
    const basename = path.basename(absolutePath);
    if ((basename.startsWith(".env") && basename !== ".env.example") || basename === ".vortexenv") {
      return "Error: Cannot read environment/secret files.";
    }

    if (!fs.existsSync(absolutePath)) {
      return `Error: File not found: ${filePath}`;
    }

    try {
      const content = fs.readFileSync(absolutePath, "utf8");
      const lines = content.split("\n");

      // Handle optional line range
      const startLine = args.startLine
        ? Math.max(1, parseInt(args.startLine, 10))
        : 1;
      const endLine = args.endLine
        ? Math.min(lines.length, parseInt(args.endLine, 10))
        : Math.min(lines.length, 100); // Cap at 100 lines to avoid context overflow

      const selectedLines = lines.slice(startLine - 1, endLine);

      return `File: ${filePath} (lines ${startLine}-${endLine} of ${lines.length})\n${"─".repeat(60)}\n${selectedLines
        .map((line, i) => `${startLine + i}: ${line}`)
        .join("\n")}`;
    } catch (err: any) {
      return `Error reading file: ${err.message}`;
    }
  }
}
