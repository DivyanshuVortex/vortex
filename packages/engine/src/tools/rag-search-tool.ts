import { AgentTool } from "./tool-types";
import { VectorStore, LocalEmbedder } from "@vortex/retrieval";

export class RagSearchTool implements AgentTool {
  name = "rag_search";
  description =
    'Search the Project Memory (RAG) to recall what was written in previous files. Args: {"query": "What CSS classes are defined in style.css?"}. Returns the most relevant code chunks.';

  private vectorStore: VectorStore;
  private embedder: LocalEmbedder;

  constructor(vectorStore: VectorStore, embedder: LocalEmbedder) {
    this.vectorStore = vectorStore;
    this.embedder = embedder;
  }

  async execute(args: Record<string, string>): Promise<string> {
    const query = args.query;
    if (!query) {
      return "Error: 'query' argument is required.";
    }

    try {
      // Create a dummy chunk to format the query for the embedder, 
      // or we could just use the embedder directly on the query string.
      // We will mock a chunk to get a good embedding representation
      const queryEmbeddingOutput = await this.embedder.embedChunks([
        {
          id: "query",
          file: "query",
          language: "text",
          name: "query",
          symbolPath: "query",
          kind: "function",
          isExported: false,
          isAsync: false,
          dependencies: [],
          startLine: 1,
          endLine: 1,
          hash: "query",
          content: query,
        }
      ]);

      const queryEmbedding = queryEmbeddingOutput[0];
      if (!queryEmbedding) {
        return "Error: Failed to generate embedding for query.";
      }
      const results = await this.vectorStore.search(queryEmbedding, 5);

      if (results.length === 0) {
        return `No relevant memory found for query: "${query}".`;
      }

      let response = `--- RAG Search Results for: "${query}" ---\n`;
      for (const result of results) {
        response += `\n[File: ${result.file}]\n${result.content}\n`;
      }

      return response;
    } catch (err: any) {
      return `Error searching memory: ${err.message}`;
    }
  }
}
