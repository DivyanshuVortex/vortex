import ora from "ora";
import * as readline from "readline/promises";
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
import { getGitRoot, isGitRepo } from "@vortex/git";
import { VectorStore, LocalEmbedder } from "@vortex/retrieval";

export async function solveCommand(prompt: string, options: { autoApprove?: boolean; maxSteps?: number; contextChunks?: AgentContextChunk[]; newProject?: string } = {}) {
  let cwd = process.cwd();

  if (options.newProject) {
    const projectPath = path.resolve(cwd, options.newProject);
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
      console.log(chalk.green(`\n📁 Created new project folder: ${projectPath}`));
    }
    cwd = projectPath;
    process.chdir(cwd);
    
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      try {
        execSync("git init", { cwd, stdio: "ignore" });
        console.log(chalk.green(`🌱 Initialized empty Git repository in ${cwd}`));
      } catch (e) {
        console.error(chalk.red("Failed to initialize git repository."));
      }
    }
  }

  let rootPath = cwd;

  if (isGitRepo(cwd)) {
    rootPath = getGitRoot(cwd);
  }

  console.log(`\n🤖 Vortex Autonomous Agent activated`);
  console.log(`Task: "${prompt}"\n`);

  const spinner = ora("Initializing Vector Store for Project Memory...").start();

  try {
    const vectorStore = new VectorStore();
    const embedder = new LocalEmbedder();
    const agent = new AutonomousAgent();
    
    // Set max steps if provided
    if (options.maxSteps !== undefined) {
      // @ts-ignore - access protected member for now until properly exposed
      agent.maxToolIterations = options.maxSteps;
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

    // Register all available tools
    agent.registerTools([
      new FileReadTool(rootPath),
      new FileWriteTool(rootPath, vectorStore, embedder, approvalCallback),
      new ShellExecuteTool(rootPath, approvalCallback),
      new GrepTool(rootPath),
      new RagSearchTool(vectorStore, embedder),
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
            // After file write completes successfully, run git diff to show the changes inline
            spinner.stop();
            try {
              // Extract the path from the toolResult if possible or simply rely on git diff
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
               // git diff might fail if the file is untracked, ignore
            }
            spinner.start("Thinking...");
          }
        }
      }
    );

    spinner.succeed("Task completed");
    
    // UI/UX Improvement: Show overall diff stat
    try {
      const statOut = execSync(`git diff --stat`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (statOut.trim()) {
        console.log(`\n${chalk.cyan('=== Changed Files Summary ===')}`);
        console.log(statOut);
      }
    } catch (e) {
      // ignore
    }

    console.log(`\n${chalk.cyan('=== Final Output ===')}\n`);
    console.log(result.summary);
  } catch (err: any) {
    spinner.fail("Agent encountered an error");
    console.error(err.message);
  }
}
