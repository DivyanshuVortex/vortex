import {
  IntelligenceAgent,
  Indexer,
  MemoryService,
  ToolRegistry,
  GrepTool,
  FileReadTool,
} from "@vortex/engine";
import { createGithubClient } from "@vortex/github";

export async function reviewCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  const { marked } = await import("marked");
  const { default: TerminalRenderer } = await import("marked-terminal");

  marked.setOptions({
    renderer: new TerminalRenderer() as any,
  });

  const reviewTitle = options.pr ? `PR #${options.pr}` : 'local';
  console.log(`\n  ${chalk.cyan('◆')} Vortex  ·  review  ·  ${reviewTitle}\n`);

  if (!process.env.GITHUB_TOKEN) {
    console.log(
      chalk.yellow(
        "⚠️ No GITHUB_TOKEN found. Using anonymous access (subject to rate limits)."
      )
    );
  }

  const repoInfo = await import("@vortex/git").then((m) =>
    m.getGithubRepoInfo(process.cwd())
  );

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
    options.pr ? `Fetching diff for ${owner}/${repo}#${options.pr}...` : `Fetching local git diff...`
  ).start();

  try {

    let diff: string;
    if (options.pr) {
      const github = createGithubClient(process.env.GITHUB_TOKEN);
      diff = await github.fetchPullRequestDiff(owner, repo, options.pr);
    } else {
      const { execSync } = await import("child_process");
      diff = execSync("git diff HEAD").toString();
      if (!diff.trim()) {
        spinner.fail("No local changes found to review. Make some changes or specify a --pr.");
        return;
      }
    }

    const diffLines = diff.split('\n').filter(l => l.startsWith('+++') || l.startsWith('---')).length / 2 || 1;
    spinner.succeed(`Fetched diff  ·  ~${Math.floor(diffLines)} files changed`);

    spinner.start("Extracting architectural queries from diff...");
    const agent = new IntelligenceAgent();
    const indexer = new Indexer();

    const queries = await agent.extractSearchQueriesFromDiff(diff);

    const allChunks: any[] = [];
    if (queries.length > 0) {
      spinner.text = `Hybrid searching for context...`;
      for (const query of queries) {
        const results = await indexer.hybridSearch(query, 3);
        allChunks.push(...results);
      }
    }

    const uniqueChunks = Array.from(
      new Map(allChunks.map((c) => [c.id, c])).values()
    );

    spinner.text = "Checking memory for relevant past reviews...";
    const memoryService = new MemoryService();
    const memories = await memoryService.recallRelevantMemories(
      `PR review ${queries.join(" ")}`,
      3
    );

    spinner.text = `Running multi-agent review (Security, Architecture, Synthesis)...`;
    const review = await agent.generateMultiAgentReview(
      diff,
      uniqueChunks,
      memories
    );

    spinner.stop();
    console.log(`  ${chalk.green('✔')} Security Agent       ${review.agentOutputs.security.findings.length} findings`);
    console.log(`  ${chalk.green('✔')} Architecture Agent   ${review.agentOutputs.architecture.findings.length} suggestions`);
    console.log(`  ${chalk.green('✔')} Synthesizer          Report ready\n`);


    const parsedReview = await marked.parse(review.markdownReport);

    const verdictColor =
      review.verdict === "SAFE_TO_MERGE"
        ? chalk.green
        : review.verdict === "REQUIRES_CHANGES"
          ? chalk.red
          : chalk.yellow;

    const borderColor =
      review.verdict === "SAFE_TO_MERGE"
        ? "green"
        : review.verdict === "REQUIRES_CHANGES"
          ? "red"
          : "yellow";

    const formatted = boxen(parsedReview.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: "double",
      borderColor: borderColor as any,
      title: chalk.bold(` Multi-Agent Code Review `),
      titleAlignment: "center",
    });

    console.log(formatted);


    console.log(
      boxen(verdictColor.bold(`  ${review.verdict}  `), {
        padding: { left: 2, right: 2 },
        borderStyle: "round",
        borderColor: borderColor as any,
        textAlignment: "center",
      })
    );


    const { security, architecture, synthesis } = review.agentOutputs;

    const secCount = security.findings.length;
    const archCount = architecture.findings.length;
    
    // Draw the summary bar chart
    console.log(`  ────────────────────────────────────────`);
    
    const secBar = secCount > 0 ? chalk.red('█'.repeat(Math.min(secCount, 10))) : chalk.green('░');
    console.log(`  SECURITY    ${secBar.padEnd(20)}  ${secCount} issues`);
    
    const archBar = archCount > 0 ? chalk.yellow('█'.repeat(Math.min(archCount, 10))) : chalk.green('░');
    console.log(`  ARCH        ${archBar.padEnd(20)}  ${archCount} suggestions`);
    
    const logicBar = synthesis.verdict === 'SAFE_TO_MERGE' ? chalk.green('░') : chalk.red('█');
    console.log(`  LOGIC       ${logicBar.padEnd(20)}  ${synthesis.verdict.toLowerCase().replace(/_/g, ' ')}`);
    console.log(`  ────────────────────────────────────────\n`);

    if (uniqueChunks.length > 0) {
      console.log(chalk.cyan.dim("\n Cross-Referenced Architecture:"));
      uniqueChunks.forEach((res: any, i: number) => {
        const sources = res.sources ? res.sources.join("+") : "vector";
        console.log(
          chalk.gray(
            `  │ [${i + 1}] ${res.file.replace(process.cwd(), "")} ➔ ${res.symbolPath || "(anonymous)"} [${sources}]`
          )
        );
      });
    }

    if (memories.length > 0) {
      console.log(chalk.yellow.dim("\n Past Review Memories Used:"));
      memories.forEach((mem: string, i: number) => {
        console.log(chalk.gray(`  │ [${i + 1}] ${mem.slice(0, 120)}...`));
      });
    }


    if (options.pr) {
      try {
        await memoryService.storeReviewMemory(options.pr, owner, repo, review);
      } catch (err) {
        console.warn(chalk.yellow("\n⚠️ Failed to store review in memory:"), err);
      }
    }

    console.log("");
  } catch (err) {
    spinner.fail("Failed to review PR");
    console.error(err);
  }
}