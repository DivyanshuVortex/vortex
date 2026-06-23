import { AgentTool } from "./tool-types";

export class WebSearchTool implements AgentTool {
  name = "web_search";
  description = `Searches the web for information, documentation, and schemas about external APIs and third-party libraries.
Use web_search when you need external context or run into an issue, such as:
- The task requires using, replacing, or debugging an external library, API, or unknown concept.
- You need documentation or examples to proceed.
- You need to look up an error message or how to fix a build/compilation error.

You MUST perform the search to guide your code modifications.
Provide the 'query' argument with your search terms.`;

  async execute(args: Record<string, string>): Promise<string> {
    const query = args.query;
    if (!query) {
      return "Error: Missing 'query' argument.";
    }

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return "Error: TAVILY_API_KEY environment variable is not set. Web search is unavailable. Please fallback to local shell_execute introspection.";
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: query,
          search_depth: "basic",
          include_answer: true,
          max_results: 3
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      let resultStr = `Search Results for: "${query}"\n`;
      if (data.answer) {
        resultStr += `\nAI Summary:\n${data.answer}\n`;
      }

      if (data.results && data.results.length > 0) {
        resultStr += "\nSources:\n";
        data.results.forEach((r: any, idx: number) => {
          resultStr += `[${idx + 1}] ${r.title}\n${r.content}\nURL: ${r.url}\n\n`;
        });
      } else {
        resultStr += "No detailed sources found.";
      }

      return resultStr;
    } catch (error: any) {
      return `Error executing web search: ${error.message}`;
    }
  }
}
