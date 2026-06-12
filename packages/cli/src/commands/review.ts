import { IntelligenceAgent } from "@vortex/engine";
import { createGithubClient } from "@vortex/github";

export async function reviewCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  const { marked } = await import("marked");
  const { default: TerminalRenderer } = await import("marked-terminal");

  marked.setOptions({
    renderer: new TerminalRenderer()
  });

  console.log(chalk.blue(`\nReviewing PR #${options.pr}`));

  if (!process.env.GITHUB_TOKEN) {
    console.log(chalk.yellow("⚠️ No GITHUB_TOKEN found. Using anonymous access (subject to rate limits)."));
  }

  const repoInfo = await import("@vortex/git").then(m => m.getGithubRepoInfo(process.cwd()));
  
  const owner = process.env.GITHUB_OWNER || repoInfo?.owner;
  const repo = process.env.GITHUB_REPO || repoInfo?.repo;

  if (!owner || !repo) {
    console.error(chalk.red("Could not determine GitHub repository. Please run this command inside a git repository or set GITHUB_OWNER and GITHUB_REPO."));
    return;
  }

  const spinner = ora(`Fetching diff for ${owner}/${repo}#${options.pr}...`).start();

  try {
    const github = createGithubClient(process.env.GITHUB_TOKEN);
    const diff = await github.fetchPullRequestDiff(owner, repo, options.pr);

    spinner.text = "Analyzing diff with Vortex Intelligence...";
    const agent = new IntelligenceAgent();
    const review = await agent.generateReview(diff);

    spinner.succeed("Review complete!\n");

    const parsedReview = await marked.parse(review);

    const formatted = boxen(parsedReview.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'double',
      borderColor: 'magenta',
      title: chalk.magenta.bold(' ✨ AI Code Review '),
      titleAlignment: 'center'
    });

    console.log(formatted);
  } catch (err) {
    spinner.fail("Failed to review PR");
    console.error(err);
  }
}