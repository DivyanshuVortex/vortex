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
  FileEditTool,
  ShellExecuteTool,
  GrepTool,
  RagSearchTool,
  WebSearchTool,
  ApprovalCallback,
  AgentContextChunk,
  IntelligenceAgent,
  Indexer
} from "@vortex/engine";
import { initDatabase } from "@vortex/db";
import { getGitRoot, isGitRepo } from "@vortex/git";
import { VectorStore, LocalEmbedder, BM25Index, HybridRetriever } from "@vortex/retrieval";

export async function solveCommand(prompt: string, options: { autoApprove?: boolean; maxSteps?: number; contextChunks?: AgentContextChunk[]; newProject?: string; verify?: string | boolean } = {}) {
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

  console.log(`\n  ${chalk.cyan('◆')} Vortex  ·  solve\n`);

  await initDatabase();

  const spinner = ora("Reading codebase...").start();

  try {
    const vectorStore = new VectorStore();
    const bm25Index = new BM25Index();
    const embedder = new LocalEmbedder();
    const hybridRetriever = new HybridRetriever(vectorStore, bm25Index, embedder);
    const agent = new AutonomousAgent();

    if (options.maxSteps !== undefined) {
      (agent as any).maxToolIterations = options.maxSteps;
    }

    if (!options.contextChunks || options.contextChunks.length === 0) {
      try {
        const indexer = new Indexer();
        const relevantContext = await indexer.hybridSearch(prompt, 15);
        options.contextChunks = relevantContext.map((c: any) => ({
          file: c.file,
          symbolPath: c.symbolPath || "anonymous",
          content: c.content,
          kind: c.kind || "unknown",
        }));
      } catch (e) {
        console.warn(chalk.yellow("⚠️ Could not search vector store. Did you run 'vortex init'?"));
        options.contextChunks = [];
      }
    }

    const intelligenceAgent = new IntelligenceAgent();
    const webSearchTool = new WebSearchTool();

    spinner.text = "Gathering external context...";
    const webQueries = await intelligenceAgent.extractWebSearchQueries(prompt);
    for (const q of webQueries.slice(0, 2)) {
      try {
        const res = await webSearchTool.execute({ query: q });
        if (!res.includes("Error: TAVILY") && res.trim().length > 0) {
          options.contextChunks = options.contextChunks || [];
          options.contextChunks.push({
            file: "Web Search Result",
            symbolPath: q,
            content: res,
            kind: "web_search"
          });
        }
      } catch (e) {}
    }

    spinner.text = "Planning approach...";
    let executionPlanStr = await intelligenceAgent.generateExecutionPlan(prompt, options.contextChunks || []);
    
    let planSummary = "task";
    let stepCount = 0;
    let executionPlan = "";
    let filesToRead: string[] = [];
    try {
      const parsedPlan = JSON.parse(executionPlanStr);
      planSummary = parsedPlan.summary || planSummary;
      stepCount = parsedPlan.steps ? parsedPlan.steps.length : 0;
      executionPlan = parsedPlan.steps ? parsedPlan.steps.map((s: any, i: number) => {
        if (typeof s === 'string') return `${i + 1}. ${s}`;
        const desc = s.description ? s.description.replace(/\n/g, '\n   ') : '';
        return `${i + 1}. [${(s.action || 'MODIFY').toUpperCase()}] ${s.file || 'General'}\n   ${desc}`;
      }).join("\n\n") : executionPlanStr;
      filesToRead = parsedPlan.filesToRead || [];
    } catch {
      executionPlan = executionPlanStr;
    }

    if (filesToRead.length > 0) {
      for (const file of filesToRead) {
        try {
          const fullPath = path.resolve(rootPath, file);
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, "utf-8");
            options.contextChunks!.push({ file, symbolPath: "file", content, kind: "file" });
          }
        } catch { }
      }
    }

    spinner.stopAndPersist({ symbol: chalk.green('✔'), text: `Plan ready  ·  ${planSummary}  (${stepCount} steps)\n` });

    console.log(`\n${chalk.cyan.dim("─── Execution Plan ───")}`);
    console.log(chalk.gray(executionPlan));
    console.log(`${chalk.cyan.dim("──────────────────────")}\n`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  Proceed? (Y/n/edit) › `);

    if (answer.toLowerCase() === 'n') {
      console.log(chalk.red('\n  ✖ Task aborted by user.\n'));
      rl.close();
      process.exit(0);
    } else if (answer.toLowerCase() === 'edit') {
      const edits = await rl.question(`  Enter instructions › `);
      if (edits.trim()) {
        executionPlan += `\n\n### User Modifications\n${edits.trim()}`;
      }
    }
    rl.close();

    const enrichedPrompt = `Original Task:\n${prompt}\n\nExecution Plan generated by Architect:\n${executionPlan}`;

    console.log(`\n  ${chalk.cyan('◆')} Vortex  ·  solving\n`);
    spinner.start("Initializing agent...");

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
      new FileWriteTool(rootPath, vectorStore, embedder, bm25Index, approvalCallback),
      new FileEditTool(rootPath, vectorStore, embedder, bm25Index, approvalCallback),
      new ShellExecuteTool(rootPath, approvalCallback),
      new GrepTool(rootPath),
      new RagSearchTool(hybridRetriever),
      new WebSearchTool(),
    ]);

    const initialState = {
      evidence: { filesRead: filesToRead, symbolsObserved: [], dependenciesObserved: [], externalSchemasFound: {}, confidence: 'LOW' as any },
      plan: { steps: [], currentStepIndex: 0, completedSteps: [] },
      execution: { filesModified: [], commandsRun: [], lastError: null, consecutiveFailures: 0 },
      verification: { contractItems: [], passed: [], failed: [] },
      verdict: 'IN_PROGRESS' as any
    };

    let verifyCmd = options.verify;
    if (verifyCmd === undefined || verifyCmd === true) {
      const packageJsonPath = path.join(cwd, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
          if (pkg.scripts && pkg.scripts.build) {
            verifyCmd = "npm run build";
          }
        } catch (e) { }
      }
    }

    const result = await agent.run(
      {
        diff: enrichedPrompt,
        contextChunks: options.contextChunks || [],
      },
      {
        initialState,
        verifyCommand: verifyCmd,
        onToolCall: (toolName, args) => {
          if (toolName === "write_file") {
            spinner.text = `Writing ${args.path}...`;
          } else if (toolName === "read_file") {
            spinner.text = `Inspecting ${args.path}...`;
          } else if (toolName === "shell_execute") {
            spinner.text = `Running verification...`;
          } else {
            spinner.text = `Using ${toolName}...`;
          }
        },
        onToolResult: (toolName, toolResult) => {
          if ((toolName === "write_file" || toolName === "replace_in_file") && toolResult.startsWith("Success")) {
            spinner.stop();
            try {
              let filePath = "";
              const matchWrite = toolResult.match(/Wrote to (.*?) successfully/);
              const matchReplace = toolResult.match(/target block in (.*?) successfully/);
              
              if (matchWrite && matchWrite[1]) filePath = matchWrite[1].trim();
              else if (matchReplace && matchReplace[1]) filePath = matchReplace[1].trim();

              if (filePath) {
                let additions = '0';
                let deletions = '0';
                const diffOut = execSync(`git diff --numstat "${filePath}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
                
                if (diffOut) {
                  const diffParts = diffOut.split(/\s+/);
                  additions = diffParts[0] || '0';
                  deletions = diffParts[1] || '0';
                } else {
                  try {
                    const fullPath = path.resolve(rootPath, filePath);
                    const content = fs.readFileSync(fullPath, "utf-8");
                    additions = content.split('\n').length.toString();
                  } catch (e) {}
                }
                
                const actionText = toolName === "replace_in_file" ? "Editing" : "Writing";
                console.log(`  ${chalk.cyan('●')} ${actionText} ${filePath}`);
                console.log(`    ${chalk.green(`+ ${additions} lines`)}  ·  ${chalk.red(`- ${deletions} lines`)}\n`);
              }
            } catch (e) {
            }
            spinner.start("Thinking...");
          }
        }
      }
    );

    let iterationCount = 1;
    if (result.summary) {
       const iterMatch = result.summary.match(/Iter (\d+)/);
       if (iterMatch && iterMatch[1]) iterationCount = parseInt(iterMatch[1], 10);
    }
    
    let filesChangedCount = 0;
    try {
      const statOut = execSync(`git diff --shortstat`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      const filesMatch = statOut.match(/(\d+) file/);
      if (filesMatch && filesMatch[1]) {
         filesChangedCount = parseInt(filesMatch[1], 10);
      }
    } catch (e) {}

    spinner.stop();
    const isIncomplete = (result as any).verdict === 'INCOMPLETE' || result.state?.verdict === 'INCOMPLETE';
    const isComplete = !isIncomplete;

    if (isIncomplete) {
      console.log(`\n  ${chalk.red('✖')} Task incomplete  ·  stopped or failed`);
    } else {
      console.log(`\n  ────────────────────────────────────────`);
      console.log(`  ${chalk.green('✔')} Task complete  ·  ${filesChangedCount} files modified  ·  ${iterationCount} iterations`);
      console.log(`  ────────────────────────────────────────\n`);
    }

  } catch (err: any) {
    spinner.fail("Agent encountered an error");
    console.error(err.message);
  }
}
