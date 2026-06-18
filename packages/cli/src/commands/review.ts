import { IntelligenceAgent, Indexer } from "@vortex/engine";
import { createGithubClient } from "@vortex/github";

export async function reviewCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  const { marked } = await import("marked");
  const { default: TerminalRenderer } = await import("marked-terminal");

  marked.setOptions({
    renderer: new TerminalRenderer() as any
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

    spinner.text = "Extracting architectural queries from diff...";
    const agent = new IntelligenceAgent();
    const indexer = new Indexer();
    
    const queries = await agent.extractSearchQueriesFromDiff(diff);
    
    const allChunks: any[] = [];
    if (queries.length > 0) {
      spinner.text = `Retrieving local context for queries: ${queries.join(", ")}...`;
      for (const query of queries) {
        const results = await indexer.search(query, 2); // Get top 2 chunks per query
        allChunks.push(...results);
      }
    }

    // Deduplicate chunks by ID
    const uniqueChunks = Array.from(new Map(allChunks.map(c => [c.id, c])).values());

    spinner.text = `Analyzing diff against ${uniqueChunks.length} local chunks...`;
    const review = await agent.generateRAGReview(diff, uniqueChunks);

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

    if (uniqueChunks.length > 0) {
      console.log(chalk.cyan.dim(" 📚 Cross-Referenced Local Architecture:"));
      uniqueChunks.forEach((res, i) => {
         console.log(chalk.gray(`  │ [${i + 1}] ${res.file.replace(process.cwd(), '')} ➔ ${res.symbolPath || '(anonymous)'}`));
      });
    }

  } catch (err) {
    spinner.fail("Failed to review PR");
    console.error(err);
  }
}