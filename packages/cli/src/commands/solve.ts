import ora from "ora";
import {
  AutonomousAgent,
  FileReadTool,
  FileWriteTool,
  ShellExecuteTool,
  GrepTool,
  RagSearchTool
} from "@vortex/engine";
import { getGitRoot, isGitRepo } from "@vortex/git";
import { VectorStore, LocalEmbedder } from "@vortex/retrieval";

export async function solveCommand(prompt: string) {
  const cwd = process.cwd();
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

    spinner.text = "Thinking...";

    // Register all available tools
    agent.registerTools([
      new FileReadTool(rootPath),
      new FileWriteTool(rootPath, vectorStore, embedder),
      new ShellExecuteTool(rootPath),
      new GrepTool(rootPath),
      new RagSearchTool(vectorStore, embedder),
    ]);

    const result = await agent.run(
      {
        diff: prompt,
        contextChunks: [],
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
      }
    );

    spinner.succeed("Task completed");
    console.log(`\n=== Final Output ===\n`);
    console.log(result.summary);
  } catch (err: any) {
    spinner.fail("Agent encountered an error");
    console.error(err.message);
  }
}

