import { Indexer } from "@vortex/engine";
import * as fs from "fs";
import * as path from "path";

export async function initCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");

  console.log(`\n  ${chalk.cyan('◆')} Vortex\n`);

  const startTime = Date.now();
  const spinner = ora("Scanning repository and building indices...").start();

  const indexer = new Indexer();
  try {
    const stats = await indexer.indexRepository(process.cwd());

    const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + "s";
    spinner.succeed(chalk.green(`${stats.filesProcessed} files indexed  ·  ${durationStr}\n`));

    // Automatically update .gitignore
    const gitignorePath = path.join(process.cwd(), ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      let content = fs.readFileSync(gitignorePath, "utf8");
      const entriesToAdd = [
        ".vortex.db",
        ".vortex-bm25.json",
        ".vortex_backup/"
      ];
      
      let changed = false;
      for (const entry of entriesToAdd) {
        if (!content.includes(entry)) {
          if (!content.endsWith("\n") && content.length > 0) {
            content += "\n";
          }
          content += entry + "\n";
          changed = true;
        }
      }
      
      if (changed) {
        fs.writeFileSync(gitignorePath, content, "utf8");
        console.log(chalk.gray(`  Updated .gitignore`));
      }
    }

  } catch (err) {
    spinner.fail(chalk.red("Failed to initialize"));
    console.error(err);
  }
}
