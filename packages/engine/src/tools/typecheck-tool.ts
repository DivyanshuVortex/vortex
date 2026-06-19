import { execSync } from "child_process";
import { AgentTool } from "./tool-types";

/**
 * TypeCheckTool — Runs the TypeScript compiler to verify code correctness.
 *
 * Agents use this to verify that their suggested fixes actually compile:
 * - "Will this change introduce type errors?"
 * - "Is this interface being used correctly?"
 *
 * Runs `tsc --noEmit` to check for type errors without producing output files.
 */
export class TypeCheckTool implements AgentTool {
  name = "type_check";
  description =
    'Run TypeScript type checking on the project or a specific file. Args: {"path": "optional file path"}. Returns any type errors found, or "No type errors" if clean.';

  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(args: Record<string, string>): Promise<string> {
    const targetPath = args.path || "";
    const command = targetPath
      ? `npx tsc --noEmit ${targetPath}`
      : `npx tsc --noEmit`;

    try {
      execSync(command, {
        cwd: this.cwd,
        encoding: "utf8",
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      });

      return "No type errors found. ✅";
    } catch (err: any) {
      // tsc exits with code 2 when there are type errors
      const output = (err.stdout || "") + (err.stderr || "");

      if (!output.trim()) {
        return "Type check completed with errors but no output was captured.";
      }

      // Limit output to avoid overwhelming the agent context
      const lines = output.trim().split("\n").slice(0, 15);
      return `Type errors found:\n${lines.join("\n")}${
        output.split("\n").length > 15
          ? `\n... and ${output.split("\n").length - 15} more errors`
          : ""
      }`;
    }
  }
}
