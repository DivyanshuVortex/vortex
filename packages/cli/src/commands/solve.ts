import ora from "ora";
import * as readline from "node:readline/promises";
import { execSync } from "child_process";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import {
  AutonomousAgent,
  FileReadTool,
  FileWriteTool,
  ShellExecuteTool,
  GrepTool,
  RagSearchTool,
  ApprovalCallback,
  AgentContextChunk
} from "@vortex/engine";
import { initDatabase } from "@vortex/db";
import { getGitRoot, isGitRepo } from "@vortex/git";
import { VectorStore, LocalEmbedder, BM25Index, HybridRetriever } from "@vortex/retrieval";

export async function solveCommand(prompt: string, options: { autoApprove?: boolean; maxSteps?: number; contextChunks?: AgentContextChunk[]; newProject?: string } = {}) {
  let cwd = process.cwd();

  if (options.newProject) {
    const projectPath = path.resolve(cwd, options.newProject);
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
      console.log(chalk.green(`\nCreated new project folder: ${projectPath}`));
    }
    cwd = projectPath;
    process.chdir(cwd);
    
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      try {
        execSync("git init", { cwd, stdio: "ignore" });
        console.log(chalk.green(`Initialized empty Git repository in ${cwd}`));
      } catch (e) {
        console.error(chalk.red("Failed to initialize git repository."));
      }
    }
  }

  let rootPath = cwd;

  if (isGitRepo(cwd)) {
    rootPath = getGitRoot(cwd);
  }

  console.log(`\nVortex Autonomous Agent activated`);
  console.log(`Task: "${prompt}"\n`);

  await initDatabase();

  const spinner = ora("Initializing Vector Store for Project Memory...").start();

  try {
    const vectorStore = new VectorStore();
    const bm25Index = new BM25Index();
    const embedder = new LocalEmbedder();
    const hybridRetriever = new HybridRetriever(vectorStore, bm25Index, embedder);
    const agent = new AutonomousAgent();
    
    if (options.maxSteps !== undefined) {
      (agent as any).maxToolIterations = options.maxSteps;
    }

    spinner.text = "Thinking...";

    const approvalCallback: ApprovalCallback = async (action: string, description: string): Promise<boolean> => {
      if (options.autoApprove) return true;
      
      const currentText = spinner.text;
      spinner.stop();
      
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      let question = "";
      if (action === "shell_execute") {
        question = `\n${chalk.yellow('⚠️ Agent wants to execute command:')}\n> ${description}\nAllow? (y/N) `;
      } else if (action === "write_file") {
        question = `\n${chalk.yellow('⚠️ Agent wants to overwrite file:')} ${description}\nAllow? (y/N) `;
      } else {
        question = `\n${chalk.yellow('⚠️ Agent wants to perform action:')} ${action} on ${description}\nAllow? (y/N) `;
      }
      
      const answer = await rl.question(question);
      rl.close();
      
      spinner.start(currentText);
      return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
    };


    agent.registerTools([
      new FileReadTool(rootPath),
      new FileWriteTool(rootPath, vectorStore, embedder, approvalCallback),
      new ShellExecuteTool(rootPath, approvalCallback),
      new GrepTool(rootPath),
      new RagSearchTool(hybridRetriever),
    ]);

    const result = await agent.run(
      {
        diff: prompt,
        contextChunks: options.contextChunks || [],
      },
      {
        onToolCall: (toolName, args) => {
          if (toolName === "write_file") {
            spinner.text = `Writing file: ${args.path}...`;
          } else if (toolName === "shell_execute") {
            spinner.text = `Executing shell command...`;
          } else if (toolName === "rag_search") {
            spinner.text = `Searching project memory for context...`;
          } else {
            spinner.text = `Agent is using tool: ${toolName}...`;
          }
        },
        onToolResult: (toolName, toolResult) => {
          if (toolName === "write_file" && toolResult.startsWith("Success")) {
            spinner.stop();
            try {
              const match = toolResult.match(/Wrote to (.*) successfully/);
              if (match && match[1]) {
                 const filePath = match[1];
                 console.log(`\n${chalk.green('✓ File updated:')} ${filePath}`);
                 const diffOut = execSync(`git diff --unified=1 ${filePath}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']});
                 if (diffOut) {
                   console.log(chalk.gray(diffOut));
                 }
              }
            } catch (e) {

            }
            spinner.start("Thinking...");
          }
        }
      }
    );

    spinner.succeed("Task completed");
    
    try {
      const statOut = execSync(`git diff --stat`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (statOut.trim()) {
        console.log(`\n${chalk.cyan('=== Changed Files Summary ===')}`);
        console.log(statOut);
      }
    } catch (e) {}

    console.log(`\n${chalk.cyan('=== Final Output ===')}\n`);
    console.log(result.summary);


    const packageJsonPath = path.join(cwd, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        if (pkg.scripts && pkg.scripts.build) {
          console.log(`\n${chalk.cyan('=== Verification ===')}`);
          const buildSpinner = ora("Running build command...").start();
          try {
            const env = { ...process.env };
            delete env.NODE_ENV;
            execSync("npm run build", { stdio: "pipe", cwd, env });
            buildSpinner.succeed("Build completed successfully.");
          } catch (e: any) {
            buildSpinner.fail("Build failed.");
            console.error(chalk.red(e.stdout ? e.stdout.toString() : e.message));
          }
        }
      } catch (e) {}
    }
  } catch (err: any) {
    spinner.fail("Agent encountered an error");
    console.error(err.message);
  }
}
