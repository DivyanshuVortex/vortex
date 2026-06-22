import { Indexer, IntelligenceAgent, MemoryService, ToolRegistry, GrepTool, FileReadTool } from "@vortex/engine";

export async function searchCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  const { marked } = await import("marked");
  const { default: TerminalRenderer } = await import("marked-terminal");

  marked.setOptions({
    renderer: new TerminalRenderer() as any
  });

  const spinner = ora(`Searching codebase for: "${options.query}"...`).start();
  const indexer = new Indexer();

  try {
    spinner.text = options.expandQuery ? "Expanding query and running parallel hybrid search..." : "Running hybrid search (vector + BM25 + cross-encoder)...";
    
    let queriesToSearch = [options.query];
    const agent = new IntelligenceAgent();

    if (options.expandQuery) {
      queriesToSearch = await agent.expandQuery(options.query);
    }

    const allResults = await Promise.all(
      queriesToSearch.map(q => indexer.hybridSearch(q, parseInt(options.limit, 10)))
    );
    
    const flatResults = allResults.flat();
    const uniqueResults = Array.from(new Map(flatResults.map((c) => [c.id, c])).values()).sort((a, b) => b.score - a.score).slice(0, parseInt(options.limit, 10));

    if (uniqueResults.length === 0) {
      spinner.fail("No relevant code found.");
      return;
    }
    
    spinner.text = `Found ${uniqueResults.length} relevant code chunks. Analyzing with AI engine...`;
    
    const memoryService = new MemoryService();
    const memories = await memoryService.recallRelevantMemories(options.query, 3);
    
    const answer = await agent.answerQueryWithContext(options.query, uniqueResults);
    
    spinner.succeed("Analysis complete!\n");
    
    const parsedAnswer = await marked.parse(answer);
    
    const formatted = boxen(parsedAnswer.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'double',
      borderColor: 'cyan',
      title: chalk.cyan.bold(' Vortex AI Engine (Hybrid Search) '),
      titleAlignment: 'center'
    });
    
    console.log(formatted);
    
    console.log(chalk.cyan.dim(" Reference Material (Hybrid Retrieval)"));
    uniqueResults.forEach((res: any, i: number) => {
      const sources = res.sources ? res.sources.join("+") : "vector";
      const scoreStr = res.score ? (res.score * 100).toFixed(1) + '%' : 'N/A';
      console.log(chalk.gray(`  │ [${i + 1}] ${res.file.replace(process.cwd(), '')} ➔ ${res.symbolPath || '(anonymous)'} (${scoreStr}) [${sources}]`));
    });

    if (memories.length > 0) {
      console.log(chalk.yellow.dim("\n Relevant Memories"));
      memories.forEach((mem: string, i: number) => {
        console.log(chalk.gray(`  │ [${i + 1}] ${mem.slice(0, 120)}...`));
      });
    }
    
  } catch (err) {
    spinner.fail("Search failed");
    console.error(err);
  }
}
