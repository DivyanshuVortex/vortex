#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import * as dotenv from "dotenv";
import * as os from "os";

// Load environment variables: local .env first, then global ~/.vortexenv fallback
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(os.homedir(), ".vortexenv") });

import { initCommand } from "./commands/init";
import { searchCommand } from "./commands/search";
import { reviewCommand } from "./commands/review";
import { issueCommand } from "./commands/issue";
import { graphCommand } from "./commands/graph";
import { suggestCommand } from "./commands/suggest";
import { fixNitbitsCommand } from "./commands/fix-nitbits";
import { analyzeCommand } from "./commands/analyze";
import { watchCommand } from "./commands/watch";

const program = new Command();

program
  .name("vortex")
  .description("Developer Intelligence & PR Review Engine")
  .version("0.1.0");

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
  .action(searchCommand);

program
  .command("review")
  .description("Review your changes using repository intelligence and historical PR patterns")
  .option("--pr <number>", "Pull request number", Number)
  .option("--deep", "Enable deep review analysis")
  .action(reviewCommand);

program
  .command("issue")
  .description("Analyze a GitHub issue, locate relevant codebase files, and propose a fix")
  .requiredOption("--id <number>", "Issue number", Number)
  .action(issueCommand);

program
  .command("graph")
  .description("Generate a Mermaid JS dependency graph of the project or a specific file")
  .option("--file <path>", "Filter graph to only include dependencies for a specific file")
  .action(graphCommand);

// ── AI-Powered Commands ──

program
  .command("suggest")
  .description("Generate AI-powered code suggestions using repository patterns and historical intelligence")
  .requiredOption("--file <path>", "Target file path")
  .option("--apply", "Apply suggestions automatically")
  .option("--deep", "Enable advanced contextual suggestions")
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
  .action(analyzeCommand);

program
  .command("watch")
  .description("Continuously monitor local changes and provide live review feedback")
  .option("--deep", "Enable deep live analysis")
  .action(watchCommand);

program.parse();