#!/usr/bin/env node

import { Command } from "commander";
import { Indexer, IntelligenceAgent } from "@vortex/engine";
import { createGithubClient } from "@vortex/github";
import * as fs from "fs";
import * as path from "path";
import * as chokidar from "chokidar";
import * as dotenv from "dotenv";
import * as os from "os";

// First load from current working directory
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
// Then fallback to a global ~/.vortexenv file for global CLI usage
dotenv.config({ path: path.resolve(os.homedir(), ".vortexenv") });

import { initCommand } from "./commands/init";
import { searchCommand } from "./commands/search";
import { reviewCommand } from "./commands/review";
import { issueCommand } from "./commands/issue";
import { graphCommand } from "./commands/graph";

const program = new Command();

program
  .name("vortex")
  .description("Developer Intelligence & PR Review Engine")
  .version("0.1.0");

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
  .option("--files <paths>", "Comma-separated list of target files")
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

program
  .command("suggest")
  .description(
    "Generate AI-powered code suggestions using repository patterns and historical intelligence"
  )
  .requiredOption(
    "--file <path>",
    "Target file path"
  )
  .option(
    "--apply",
    "Apply suggestions automatically"
  )
  .option(
    "--deep",
    "Enable advanced contextual suggestions"
  )
  .action(async (options) => {
    console.log(`Generating suggestions for: ${options.file}`);

    if (!fs.existsSync(options.file)) {
      console.error(`File not found: ${options.file}`);
      return;
    }

    try {
      const content = fs.readFileSync(options.file, "utf8");
      const agent = new IntelligenceAgent();
      
      console.log("Analyzing file...");
      const suggestions = await agent.generateSuggestions(content);
      
      console.log("\n--- SUGGESTIONS ---\n");
      console.log(suggestions);
    } catch (err) {
      console.error("Failed to generate suggestions:", err);
    }
  });

program
  .command("fix-nitbits")
  .description(
    "Automatically fix formatting, comments, tests, CI issues, and repository-specific patterns"
  )
  .option(
    "--safe",
    "Apply only deterministic safe fixes"
  )
  .option(
    "--dry-run",
    "Preview fixes without modifying files"
  )
  .option(
    "--files <paths>",
    "Comma-separated list of target files"
  )
  .action(async (options) => {
    console.log("Fixing repository nitbits...");

    if (!options.files) {
      console.error("Please provide --files to fix.");
      return;
    }

    const files = options.files.split(",").map((file: string) => file.trim());
    const agent = new IntelligenceAgent();

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.warn(`File not found: ${file}`);
        continue;
      }

      try {
        console.log(`Auto-fixing ${file}...`);
        const content = fs.readFileSync(file, "utf8");
        const fixedContent = await agent.autoFix(content);
        
        if (options.dryRun) {
          console.log(`\n--- FIXED OUTPUT FOR ${file} ---\n`);
          console.log(fixedContent);
        } else {
          fs.writeFileSync(file, fixedContent, "utf8");
          console.log(`✅ Fixed and saved ${file}`);
        }
      } catch (err) {
        console.error(`Failed to fix ${file}:`, err);
      }
    }
  });

program
  .command("analyze")
  .description(
    "Analyze other contributors' PRs using repository history and architectural intelligence"
  )
  .requiredOption(
    "--pr <number>",
    "Pull request number",
    Number
  )
  .option(
    "--deep",
    "Enable advanced PR intelligence analysis"
  )
  .action(async (options) => {
    console.log(`Analyzing external PR #${options.pr}`);
    
    // We reuse the review logic for now, but in a real app this would
    // have a specialized prompt focused on security/contribution guidelines.
    if (!process.env.GITHUB_TOKEN) {
      console.error("Please set GITHUB_TOKEN environment variable.");
      return;
    }

    const owner = process.env.GITHUB_OWNER || "divyanshu";
    const repo = process.env.GITHUB_REPO || "vortex";

    try {
      const github = createGithubClient(process.env.GITHUB_TOKEN);
      const diff = await github.fetchPullRequestDiff(owner, repo, options.pr);

      const agent = new IntelligenceAgent();
      const review = await agent.generateReview(diff);

      console.log("\n--- EXTERNAL PR ANALYSIS ---\n");
      console.log(review);
    } catch (err) {
      console.error("Failed to analyze PR:", err);
    }
  });

program
  .command("watch")
  .description(
    "Continuously monitor local changes and provide live review feedback"
  )
  .option(
    "--deep",
    "Enable deep live analysis"
  )
  .action((options) => {
    console.log("Watching repository changes for live AI feedback...");

    if (options.deep) {
      console.log("Deep live analysis enabled (may consume more API tokens).");
    }

    const watcher = chokidar.watch(process.cwd(), {
      ignored: /(^|[\/\\])\..|node_modules|dist/, // ignore dotfiles, node_modules, dist
      persistent: true
    });

    const agent = new IntelligenceAgent();
    let isProcessing = false;

    watcher.on("change", async (path) => {
      if (isProcessing) return; // Debounce or ignore if already processing
      
      console.log(`\nDetected change in ${path}. Analyzing...`);
      isProcessing = true;

      try {
        const content = fs.readFileSync(path, "utf8");
        const feedback = await agent.generateSuggestions(content);
        
        console.log(`\n--- LIVE AI FEEDBACK FOR ${path} ---\n`);
        console.log(feedback);
      } catch (err) {
        console.error("Analysis failed:", err);
      } finally {
        isProcessing = false;
        console.log("\nWatching for more changes...");
      }
    });

    console.log("Started watcher. Press Ctrl+C to exit.");
  });

program.parse();