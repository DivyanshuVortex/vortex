#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import * as dotenv from "dotenv";
import * as os from "os";

// Suppress dotenv logging
process.env.DOTENV_CONFIG_QUIET = "true";


const monorepoEnv = path.resolve(__dirname, "../../../.env");
if (require("fs").existsSync(monorepoEnv)) {
  const envConfig = dotenv.parse(require("fs").readFileSync(monorepoEnv));
  for (const k in envConfig) {
    if (k === "NODE_ENV") continue;
    if (!process.env[k]) process.env[k] = envConfig[k];
  }
}


dotenv.config({ path: path.resolve(os.homedir(), ".vortexenv"), override: true });


const cwdEnv = path.resolve(process.cwd(), ".env");
if (require("fs").existsSync(cwdEnv)) {
  const envConfig = dotenv.parse(require("fs").readFileSync(cwdEnv));
  for (const k in envConfig) {
    if (k === "NODE_ENV") continue;
    process.env[k] = envConfig[k];
  }
}

import { initCommand } from "./commands/init";
import { searchCommand } from "./commands/search";
import { reviewCommand } from "./commands/review";
import { issueCommand } from "./commands/issue";
import { graphCommand } from "./commands/graph";
import { suggestCommand } from "./commands/suggest";
import { fixNitbitsCommand } from "./commands/fix-nitbits";
import { analyzeCommand } from "./commands/analyze";
import { solveCommand } from "./commands/solve";
import { solveIssueCommand } from "./commands/solve-issue";
import { cacheCommand } from "./commands/cache";
import { configSet, configGet, configList } from "./commands/config";

const program = new Command();

const { version } = require("../package.json");

program
  .name("vortex")
  .description("Developer Intelligence & PR Review Engine")
  .version(version);

program.hook("preAction", (thisCommand, actionCommand) => {
  if (actionCommand.opts().cache === false) {
    process.env.VORTEX_DISABLE_CACHE = "true";
  }
});

// ── Core Commands ──

program
  .command("init")
  .description("Initialize repository intelligence, embeddings, and PR history")
  .option("--reindex", "Rebuild repository embeddings while preserving historical PR intelligence")
  .action(initCommand);

program
  .command("search")
  .description("Search the indexed codebase semantically and get an AI explanation")
  .requiredOption("-q, --query <text>", "Search query")
  .option("-l, --limit <number>", "Number of results to consider", "5")
  .option("--no-cache", "Disable LLM response caching")
  .action(searchCommand);

program
  .command("review")
  .description("Review your changes using repository intelligence and historical PR patterns")
  .option("--pr <number>", "Pull request number", Number)
  .option("--deep", "Enable deep review analysis")
  .option("--no-cache", "Disable LLM response caching")
  .action(reviewCommand);

program
  .command("issue")
  .description("Analyze a GitHub issue, locate relevant codebase files, and propose a fix")
  .requiredOption("--id <number>", "Issue number", Number)
  .option("--no-cache", "Disable LLM response caching")
  .action(issueCommand);

program
  .command("graph")
  .description("Generate a Mermaid JS dependency graph of the project or a specific file")
  .option("--file <path>", "Filter graph to only include dependencies for a specific file")
  .option("--detailed", "Include individual functions and classes in the graph instead of just files")
  .action(graphCommand);

program
  .command("solve")
  .description("Autonomously solve a task by writing code and executing commands")
  .argument("<prompt>", "The task you want the autonomous agent to solve")
  .option("--auto-approve", "Skip interactive prompts for file writes and shell commands")
  .option("--max-steps <number>", "Maximum number of agent loop iterations", Number, 30)
  .option("--new-project <folder>", "Create a new project folder and initialize git before solving")
  .action((prompt, options) => solveCommand(prompt, options));

program
  .command("solve-issue")
  .description("Autonomously solve a GitHub issue using local RAG context")
  .requiredOption("--id <number>", "Issue number", Number)
  .option("--auto-approve", "Skip interactive prompts for file writes and shell commands")
  .option("--max-steps <number>", "Maximum number of agent loop iterations", Number, 30)
  .action(solveIssueCommand);

// ── AI-Powered Commands ──

program
  .command("suggest")
  .description("Generate AI-powered code suggestions using repository patterns and historical intelligence")
  .requiredOption("--file <path>", "Target file path")
  .option("--apply", "Apply suggestions automatically")
  .option("--deep", "Enable advanced contextual suggestions")
  .option("--no-cache", "Disable LLM response caching")
  .action(suggestCommand);

program
  .command("fix-nitbits")
  .description("Automatically fix formatting, comments, tests, CI issues, and repository-specific patterns")
  .option("--safe", "Apply only deterministic safe fixes")
  .option("--dry-run", "Preview fixes without modifying files")
  .option("--files <paths>", "Comma-separated list of target files")
  .action(fixNitbitsCommand);

program
  .command("analyze")
  .description("Analyze other contributors' PRs using repository history and architectural intelligence")
  .requiredOption("--pr <number>", "Pull request number", Number)
  .option("--deep", "Enable advanced PR intelligence analysis")
  .option("--no-cache", "Disable LLM response caching")
  .action(analyzeCommand);

const configCmd = program
  .command("config")
  .description("Manage global configuration and API keys");

configCmd
  .command("set <provider> <key>")
  .description("Set an API key for a specific provider (gemini or groq)")
  .action(configSet);

configCmd
  .command("get <key>")
  .description("Get a global configuration value")
  .action(configGet);

configCmd
  .command("list")
  .description("List all global configuration values")
  .action(configList);

program.addCommand(cacheCommand);

program.parse();