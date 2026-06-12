import { Indexer, IntelligenceAgent } from "@vortex/engine";

export async function searchCommand(options: any) {
  const { default: ora } = await import("ora");
  const { default: chalk } = await import("chalk");
  const { default: boxen } = await import("boxen");
  const { marked } = await import("marked");
  const { default: TerminalRenderer } = await import("marked-terminal");

  marked.setOptions({
    renderer: new TerminalRenderer()
  });

  const spinner = ora(`Searching codebase for: "${options.query}"...`).start();
  const indexer = new Indexer();
  try {
    const results = await indexer.search(options.query, parseInt(options.limit, 10));
    
    if (results.length === 0) {
      spinner.fail("No relevant code found.");
      return;
    }
    
    spinner.text = `Found ${results.length} relevant code chunks. Analyzing with Gemini...`;
    
    const agent = new IntelligenceAgent();
    const answer = await agent.answerQueryWithContext(options.query, results);
    
    spinner.succeed("Analysis complete!\n");
    
    const parsedAnswer = await marked.parse(answer);
    
    const formatted = boxen(parsedAnswer.trim(), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1 },
      borderStyle: 'double',
      borderColor: 'cyan',
      title: chalk.cyan.bold(' ✨ Vortex AI Engine '),
      titleAlignment: 'center'
    });
    
    console.log(formatted);
    
    console.log(chalk.cyan.dim(" 📚 Reference Material"));
    results.forEach((res, i) => {
       console.log(chalk.gray(`  │ [${i + 1}] ${res.file.replace(process.cwd(), '')} ➔ ${res.symbolPath || '(anonymous)'} (${res.score ? (res.score * 100).toFixed(1) + '%' : 'N/A'})`));
    });
    
  } catch (err) {
    spinner.fail("Search failed");
    console.error(err);
  }
}
