import { Indexer } from "@vortex/engine";

export async function initCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");

  console.log(chalk.blue.bold("\n🌀 Initializing Vortex Intelligence Layer\n"));

  if (options.reindex) {
    console.log(chalk.yellow("  ♻️  Reindex mode: Rebuilding embeddings and BM25 index"));
    console.log(chalk.yellow("  📦 Historical review memory will be preserved\n"));
  }

  const spinner = ora("Scanning repository and building indices...").start();

  const indexer = new Indexer();
  try {
    const stats = await indexer.indexRepository(process.cwd());

    spinner.succeed(chalk.green("Initialization complete!\n"));

    console.log(chalk.white.bold("  📊 Index Statistics:"));
    console.log(chalk.gray(`     Files processed:  ${stats.filesProcessed}`));
    console.log(chalk.gray(`     Chunks indexed:   ${stats.chunksIndexed}`));
    console.log(chalk.cyan(`     BM25 documents:   ${stats.bm25Documents}`));
    console.log(chalk.gray(`     Vector store:     SQLite (Prisma)`));
    console.log(chalk.gray(`     BM25 index:       .vortex-bm25.json\n`));

    console.log(chalk.green("  ✅ Ready for:"));
    console.log(chalk.gray("     • vortex search -q \"your query\"     (hybrid search)"));
    console.log(chalk.gray("     • vortex review --pr <number>       (multi-agent review)"));
    console.log(chalk.gray("     • vortex issue --id <number>        (issue analysis)\n"));
  } catch (err) {
    spinner.fail(chalk.red("Failed to initialize"));
    console.error(err);
  }
}
