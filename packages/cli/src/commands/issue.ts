import { Indexer, IntelligenceAgent } from "@vortex/engine";
import { createGithubClient } from "@vortex/github";
import { getGithubRepoInfo } from "@vortex/git";

export async function issueCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  const { marked } = await import("marked");
  const { default: TerminalRenderer } = await import("marked-terminal");

  marked.setOptions({
    renderer: new TerminalRenderer()
  });

  console.log(chalk.blue(`\nAnalyzing Issue #${options.id}`));

  if (!process.env.GITHUB_TOKEN) {
    console.log(chalk.yellow("⚠️ No GITHUB_TOKEN found. Using anonymous access (subject to rate limits)."));
  }

  const repoInfo = getGithubRepoInfo(process.cwd());
  const owner = process.env.GITHUB_OWNER || repoInfo?.owner;
  const repo = process.env.GITHUB_REPO || repoInfo?.repo;

  if (!owner || !repo) {
    console.error(chalk.red("Could not determine GitHub repository. Please run this command inside a git repository or set GITHUB_OWNER and GITHUB_REPO."));
    return;
  }

  const spinner = ora(`Fetching Issue #${options.id} from ${owner}/${repo}...`).start();

  try {
    const github = createGithubClient(process.env.GITHUB_TOKEN);
    const issue = await github.fetchIssue(owner, repo, options.id);
    const comments = await github.fetchIssueComments(owner, repo, options.id);

    spinner.text = `Issue fetched. Searching local vector database for relevant code...`;
    
    // Perform RAG lookup using the issue title as the query!
    const indexer = new Indexer();
    const relevantContext = await indexer.search(issue.title, 5);

    spinner.text = "Analyzing issue and relevant codebase context with Vortex Intelligence...";
    const agent = new IntelligenceAgent();
    
    const analysis = await agent.generateIssueAnalysis(
      issue.title, 
      issue.body, 
      comments, 
      relevantContext
    );

    spinner.succeed("Issue Analysis complete!\n");

    const parsedAnalysis = await marked.parse(analysis);

    const formatted = boxen(parsedAnalysis.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'double',
      borderColor: 'green',
      title: chalk.green.bold(' ✨ AI Issue Analyzer '),
      titleAlignment: 'center'
    });

    console.log(formatted);
    
    if (relevantContext.length > 0) {
      console.log(chalk.cyan.dim(" 📚 Relevant Code Files Discovered"));
      relevantContext.forEach((res: any, i: number) => {
         console.log(chalk.gray(`  │ [${i + 1}] ${res.file.replace(process.cwd(), '')} ➔ ${res.symbolPath || '(anonymous)'} (${res.score ? (res.score * 100).toFixed(1) + '%' : 'N/A'})`));
      });
    }

  } catch (err) {
    spinner.fail("Failed to analyze issue");
    console.error(err);
  }
}
