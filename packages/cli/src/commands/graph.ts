import { GraphRetriever } from "@vortex/retrieval";
import { initDatabase } from "@vortex/db";

export async function graphCommand(options: { file?: string; detailed?: boolean }) {
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  
  console.log(chalk.blue.bold("\n🌀 Generating Dependency Graph...\n"));

  try {
    await initDatabase();
    const graphRetriever = new GraphRetriever();
    
    const asciiTree = await graphRetriever.generateAsciiTree(options.file);
    const mermaidCode = await graphRetriever.generateMermaidGraph(options.file, options.detailed);

    console.log(
      boxen(asciiTree.trim(), {
        padding: { top: 1, bottom: 1, left: 2, right: 2 },
        margin: { top: 1, bottom: 1 },
        borderStyle: "round",
        borderColor: "cyan",
        title: chalk.bold(` ✨ Dependency Graph `),
        titleAlignment: "center",
      })
    );

    if (options.file) {
      console.log(chalk.green(`✅ Graph generated successfully for file: ${options.file}`));
    } else {
      console.log(chalk.green("✅ Project dependency graph generated successfully."));
    }
    
    // Generates a direct link to the Mermaid Live editor.
    const state = { code: mermaidCode, mermaid: "{\n  \"theme\": \"dark\"\n}", autoSync: true, updateDiagram: true };
    const base64 = Buffer.from(JSON.stringify(state)).toString('base64');
    const liveUrl = `https://mermaid.live/edit#base64:${base64}`;

    console.log(chalk.dim(`\nWant a visual flowchart? Open this URL:\n${liveUrl}`));
  } catch (err) {
    console.error(chalk.red("Failed to generate graph:"), err);
  }
}
