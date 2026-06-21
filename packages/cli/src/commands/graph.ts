import { GraphRetriever } from "@vortex/retrieval";
import { initDatabase, findProjectRoot } from "@vortex/db";
import * as path from "path";

export async function graphCommand(options: { file?: string; detailed?: boolean }) {
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  
  console.log(chalk.blue.bold("\nGenerating Dependency Graph...\n"));

  try {
    await initDatabase();
    const graphRetriever = new GraphRetriever();
    

    let fileFilter = options.file;
    if (!fileFilter) {
      const projectRoot = findProjectRoot(process.cwd());
      const relPath = path.relative(projectRoot, process.cwd());
      if (relPath && relPath !== ".") {
        fileFilter = relPath;
        console.log(chalk.dim(`Directory filter auto-applied: ${fileFilter}`));
      }
    }

    const asciiTree = await graphRetriever.generateAsciiTree(fileFilter);
    const mermaidCode = await graphRetriever.generateMermaidGraph(fileFilter, options.detailed);

    console.log(
      boxen(asciiTree.trim(), {
        padding: { top: 1, bottom: 1, left: 2, right: 2 },
        margin: { top: 1, bottom: 1 },
        borderStyle: "round",
        borderColor: "cyan",
        title: chalk.bold(` Dependency Graph `),
        titleAlignment: "center",
      })
    );

    if (options.file) {
      console.log(chalk.green(`✅ Graph generated successfully for file: ${options.file}`));
    } else {
      console.log(chalk.green("✅ Project dependency graph generated successfully."));
    }
    

    const mermaidConfig = {
      theme: "dark",
      maxTextSize: 900000
    };
    const state = { code: mermaidCode, mermaid: JSON.stringify(mermaidConfig, null, 2), autoSync: true, updateDiagram: true };
    const base64 = Buffer.from(JSON.stringify(state)).toString('base64');
    const liveUrl = `https://mermaid.live/edit#base64:${base64}`;

    console.log(chalk.dim(`\nWant a visual flowchart? Open this URL:\n${liveUrl}`));
  } catch (err) {
    console.error(chalk.red("Failed to generate graph:"), err);
  }
}
