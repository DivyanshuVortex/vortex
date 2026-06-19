import { exec } from "child_process";
import { promisify } from "util";
import { AgentTool } from "./tool-types";

const execAsync = promisify(exec);

/**
 * ShellExecuteTool — Executes a shell command.
 *
 * Agents use this to run builds, tests, or install dependencies.
 */
export class ShellExecuteTool implements AgentTool {
  name = "shell_execute";
  description =
    'Execute a shell command. Args: {"command": "the command to run"}. Returns the standard output or error output.';

  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(args: Record<string, string>): Promise<string> {
    const command = args.command;
    
    if (!command) {
      return "Error: 'command' argument is required.";
    }

    try {
      const { stdout, stderr } = await execAsync(command, { cwd: this.cwd });
      let result = "";
      if (stdout) {
        result += `STDOUT:\n${stdout}\n`;
      }
      if (stderr) {
        result += `STDERR:\n${stderr}\n`;
      }
      return result || "Success: Command completed with no output.";
    } catch (err: any) {
      return `Error executing command: ${err.message}\nSTDOUT: ${err.stdout}\nSTDERR: ${err.stderr}`;
    }
  }
}
