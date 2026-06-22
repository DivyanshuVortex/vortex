import { Indexer } from "@vortex/engine";

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

  } catch (err) {
    spinner.fail(chalk.red("Failed to initialize"));
    console.error(err);
  }
}
