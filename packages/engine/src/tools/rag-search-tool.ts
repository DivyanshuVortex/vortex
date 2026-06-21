import { AgentTool } from "./tool-types";
import { HybridRetriever } from "@vortex/retrieval";

export class RagSearchTool implements AgentTool {
  name = "rag_search";
  description =
    'Search the Project Memory (RAG) to recall what was written in previous files or understand how files connect. Args: {"query": "What CSS classes are defined in style.css?"}. Returns the most relevant code chunks and their dependency graph context.';

  private hybridRetriever: HybridRetriever;

  constructor(hybridRetriever: HybridRetriever) {
    this.hybridRetriever = hybridRetriever;
  }

  async execute(args: Record<string, string>): Promise<string> {
    const query = args.query;
    if (!query) {
      return "Error: 'query' argument is required.";
    }

    try {
      const results = await this.hybridRetriever.search(query, { topK: 5 });

      if (results.length === 0) {
        return `No relevant memory found for query: "${query}".`;
      }

      let response = `--- RAG Search Results for: "${query}" ---\n`;
      for (const result of results) {
        const c = result.chunk;
        response += `\n[File: ${c.file} | Symbol: ${c.symbolPath || 'anonymous'}]\n${c.content}\n`;
      }

      return response;
    } catch (err: any) {
      return `Error searching memory: ${err.message}`;
    }
  }
}
