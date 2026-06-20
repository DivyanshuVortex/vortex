import { Indexer } from "@vortex/engine";
import { createGithubClient } from "@vortex/github";
import { getGithubRepoInfo } from "@vortex/git";
import { solveCommand } from "./solve";

export async function solveIssueCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");

  console.log(chalk.blue(`\n🚀 Autonomous Agent solving Issue #${options.id}`));

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
    
    // Perform RAG lookup using the issue title as the query
    const indexer = new Indexer();
    const relevantContext = await indexer.hybridSearch(issue.title, 5);
    
    spinner.succeed("Issue and Context fetched successfully!\n");
    
    // Construct the prompt for the AutonomousAgent
    const prompt = `Solve the following GitHub issue:
# ${issue.title}

${issue.body || "No description provided."}

## Discussion Comments
${comments.map((c: any, i: number) => `Comment ${i + 1} (@${c.user?.login}): ${c.body}`).join('\n')}

Please fix this issue in the codebase.`;

    // Map hybrid search results to AgentContextChunk format
    const contextChunks = relevantContext.map((c: any) => ({
      file: c.file,
      symbolPath: c.symbolPath || "anonymous",
      content: c.content,
      kind: c.kind || "unknown",
    }));

    // Delegate to the autonomous solver
    await solveCommand(prompt, {
      autoApprove: options.autoApprove,
      maxSteps: options.maxSteps,
      contextChunks: contextChunks
    });

  } catch (err) {
    spinner.fail("Failed to setup solve-issue");
    console.error(err);
  }
}
