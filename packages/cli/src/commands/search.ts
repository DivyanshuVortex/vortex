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
    // Use hybrid search (vector + BM25 + cross-encoder reranking)
    spinner.text = "Running hybrid search (vector + BM25 + cross-encoder)...";
    const results = await indexer.hybridSearch(options.query, parseInt(options.limit, 10));
    
    if (results.length === 0) {
      spinner.fail("No relevant code found.");
      return;
    }
    
    spinner.text = `Found ${results.length} relevant code chunks. Analyzing with Gemini...`;
    
    // Check for relevant memories
    const memoryService = new MemoryService();
    const memories = await memoryService.recallRelevantMemories(options.query, 3);
    
    const agent = new IntelligenceAgent();
    const answer = await agent.answerQueryWithContext(options.query, results);
    
    spinner.succeed("Analysis complete!\n");
    
    const parsedAnswer = await marked.parse(answer);
    
    const formatted = boxen(parsedAnswer.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'double',
      borderColor: 'cyan',
      title: chalk.cyan.bold(' ✨ Vortex AI Engine (Hybrid Search) '),
      titleAlignment: 'center'
    });
    
    console.log(formatted);
    
    // Show reference material with source attribution
    console.log(chalk.cyan.dim(" 📚 Reference Material (Hybrid Retrieval)"));
    results.forEach((res: any, i: number) => {
      const sources = res.sources ? res.sources.join("+") : "vector";
      const scoreStr = res.score ? (res.score * 100).toFixed(1) + '%' : 'N/A';
      console.log(chalk.gray(`  │ [${i + 1}] ${res.file.replace(process.cwd(), '')} ➔ ${res.symbolPath || '(anonymous)'} (${scoreStr}) [${sources}]`));
    });

    // Show relevant memories if any
    if (memories.length > 0) {
      console.log(chalk.yellow.dim("\n 🧠 Relevant Memories"));
      memories.forEach((mem: string, i: number) => {
        console.log(chalk.gray(`  │ [${i + 1}] ${mem.slice(0, 120)}...`));
      });
    }
    
  } catch (err) {
    spinner.fail("Search failed");
    console.error(err);
  }
}
