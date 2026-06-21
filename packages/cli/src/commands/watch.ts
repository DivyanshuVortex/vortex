import { IntelligenceAgent } from "@vortex/engine";
import * as fs from "fs";
import * as chokidar from "chokidar";

export async function watchCommand(options: { deep?: boolean }) {
  const { default: chalk } = await import("chalk");

  console.log(
    chalk.blue.bold("\nVortex Live Watcher\n")
  );
  console.log(
    chalk.gray("  Watching repository changes for live AI feedback...")
  );

  if (options.deep) {
    console.log(
      chalk.yellow(
        "  ⚠️  Deep live analysis enabled (may consume more API tokens).\n"
      )
    );
  }

  const watcher = chokidar.watch(process.cwd(), {
    ignored: /(^|[\/\\])\\..|node_modules|dist/,
    persistent: true,
  });

  const agent = new IntelligenceAgent();
  let isProcessing = false;

  watcher.on("change", async (filePath) => {
    if (isProcessing) return; // Debounce

    console.log(
      chalk.cyan(`\nDetected change in ${filePath}. Analyzing...`)
    );
    isProcessing = true;

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const feedback = await agent.generateSuggestions(content);

      console.log(
        chalk.green(`\n--- LIVE AI FEEDBACK FOR ${filePath} ---\n`)
      );
      console.log(feedback);
    } catch (err) {
      console.error(chalk.red("Analysis failed:"), err);
    } finally {
      isProcessing = false;
      console.log(chalk.gray("\n  Watching for more changes..."));
    }
  });

  console.log(chalk.green("  Watcher started. Press Ctrl+C to exit.\n"));
}
