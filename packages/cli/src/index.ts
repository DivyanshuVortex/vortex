#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import * as dotenv from "dotenv";
import * as os from "os";
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

import { solveCommand } from "./commands/solve";
import { solveIssueCommand } from "./commands/solve-issue";
import { cacheCommand } from "./commands/cache";

const program = new Command();

const { version } = require("../package.json");

program
  .name("vortex")
  .description("Developer Intelligence & PR Review Engine")
  .version(version);

program.hook("preAction", async (thisCommand, actionCommand) => {
  if (actionCommand.opts().cache === false) {
    process.env.VORTEX_DISABLE_CACHE = "true";
  }

  const cmdName = actionCommand.name();
  if (['solve', 'solve-issue', 'review', 'suggest', 'analyze', 'search'].includes(cmdName)) {
    const { default: ora } = await import("ora");
    const { default: chalk } = await import("chalk");
    
    console.log(`\n  ${chalk.cyan('◆')} Vortex\n`);
    const spinner = ora("Looking for model...").start();
    
    if (process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY) {
       const priorityString = process.env.VORTEX_MODEL_PRIORITY;
       const models = priorityString 
         ? priorityString.split(",").map(s => s.trim()).filter(Boolean)
         : ["nvidia/nemotron-3-ultra-550b-a55b:free", "nex-agi/nex-n2-pro:free", "openrouter/owl-alpha", "gemini-2.5-flash"];
       const topModel = models[0] || "gemini";
       spinner.succeed(`Model router active  ·  priority: ${topModel}\n`);
    } else {
       spinner.fail(chalk.red("No model configured"));
       console.log(`\n  Run:  ${chalk.cyan('vortex config set gemini "your_key_here"')}\n`);
       process.exit(1);
    }
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
  .option("--expand-query", "Expand the search query using the LLM for better recall")
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
  .option("--verify [command]", "Run a verification command after completion (e.g., 'npm run check-types'). Agent will self-correct on failure.")
  .action((prompt, options) => solveCommand(prompt, options));

program
  .command("solve-issue")
  .description("Autonomously solve a GitHub issue using local RAG context")
  .requiredOption("--id <number>", "Issue number", Number)
  .option("--auto-approve", "Skip interactive prompts for file writes and shell commands")
  .option("--max-steps <number>", "Maximum number of agent loop iterations", Number, 30)
  .option("--verify [command]", "Run a verification command after completion. Agent will self-correct on failure.")
  .action(solveIssueCommand);

// ── AI-Powered Commands ──

program.addCommand(cacheCommand);

program.parse();