import { IntelligenceAgent } from "@vortex/engine";
import { createGithubClient } from "@vortex/github";
import { getGithubRepoInfo } from "@vortex/git";

export async function analyzeCommand(options: {
  pr: number;
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
    chalk.blue.bold(`\nAnalyzing External PR #${options.pr}\n`)
  );

  if (!process.env.GITHUB_TOKEN) {
    console.error(
      chalk.red("Please set GITHUB_TOKEN environment variable.")
    );
    return;
  }

  const repoInfo = getGithubRepoInfo(process.cwd());
  const owner = process.env.GITHUB_OWNER || repoInfo?.owner;
  const repo = process.env.GITHUB_REPO || repoInfo?.repo;

  if (!owner || !repo) {
    console.error(
      chalk.red(
        "Could not determine GitHub repository. Please run this command inside a git repository or set GITHUB_OWNER and GITHUB_REPO."
      )
    );
    return;
  }

  const spinner = ora(
    `Fetching diff for ${owner}/${repo}#${options.pr}...`
  ).start();

  try {
    const github = createGithubClient(process.env.GITHUB_TOKEN);
    const diff = await github.fetchPullRequestDiff(owner, repo, options.pr);

    spinner.text = "Generating AI analysis...";

    const agent = new IntelligenceAgent();
    const review = await agent.generateReview(diff);

    spinner.succeed(chalk.green("Analysis complete!\n"));

    const parsedReview = await marked.parse(review);

    const formatted = boxen(parsedReview.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: "double",
      borderColor: "magenta",
      title: chalk.magenta.bold(" External PR Analysis "),
      titleAlignment: "center",
    });

    console.log(formatted);
  } catch (err) {
    spinner.fail(chalk.red("Failed to analyze PR"));
    console.error(err);
  }
}
