import { IntelligenceAgent } from "@vortex/engine";
import * as fs from "fs";

export async function fixNitbitsCommand(options: {
  safe?: boolean;
  dryRun?: boolean;
  files?: string;
}) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");

  console.log(chalk.blue.bold("\nFixing Repository Nitbits\n"));

  if (!options.files) {
    console.error(
      chalk.red("Please provide --files to fix (comma-separated list).")
    );
    return;
  }

  const files = options.files.split(",").map((file: string) => file.trim());
  const agent = new IntelligenceAgent();

  let fixedCount = 0;
  let failedCount = 0;

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.warn(chalk.yellow(`⚠️  File not found: ${file}`));
      failedCount++;
      continue;
    }

    const spinner = ora(`Auto-fixing ${file}...`).start();

    try {
      const content = fs.readFileSync(file, "utf8");
      const fixedContent = await agent.autoFix(content);

      if (options.dryRun) {
        spinner.succeed(chalk.cyan(`[DRY RUN] ${file}`));
        console.log(chalk.gray(`\n--- FIXED OUTPUT ---\n`));
        console.log(fixedContent);
        console.log(chalk.gray(`\n--- END ---\n`));
      } else {
        fs.writeFileSync(file, fixedContent, "utf8");
        spinner.succeed(chalk.green(`Fixed and saved ${file}`));
      }

      fixedCount++;
    } catch (err) {
      spinner.fail(chalk.red(`Failed to fix ${file}`));
      console.error(err);
      failedCount++;
    }
  }

  console.log(
    chalk.dim(
      `\n  Summary: ${fixedCount} fixed, ${failedCount} failed out of ${files.length} files\n`
    )
  );
}
