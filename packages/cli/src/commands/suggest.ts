import { IntelligenceAgent } from "@vortex/engine";
import * as fs from "fs";

export async function suggestCommand(options: {
  file: string;
  apply?: boolean;
  deep?: boolean;
}) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  const { marked } = await import("marked");
  const { default: TerminalRenderer } = await import("marked-terminal");

  marked.setOptions({
    renderer: new TerminalRenderer() as any,
  });

  console.log(
    chalk.blue.bold(`\n🌀 Generating Suggestions for: ${options.file}\n`)
  );

  if (!fs.existsSync(options.file)) {
    console.error(chalk.red(`File not found: ${options.file}`));
    return;
  }

  const spinner = ora("Analyzing file...").start();

  try {
    const content = fs.readFileSync(options.file, "utf8");
    const agent = new IntelligenceAgent();

    const suggestions = await agent.generateSuggestions(content);

    spinner.succeed(chalk.green("Analysis complete!\n"));

    const parsedSuggestions = await marked.parse(suggestions);

    const formatted = boxen(parsedSuggestions.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: "double",
      borderColor: "cyan",
      title: chalk.cyan.bold(" ✨ AI Code Suggestions "),
      titleAlignment: "center",
    });

    console.log(formatted);
  } catch (err) {
    spinner.fail(chalk.red("Failed to generate suggestions"));
    console.error(err);
  }
}
