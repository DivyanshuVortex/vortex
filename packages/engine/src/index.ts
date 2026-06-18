import { listTrackedFiles, isGitRepo, getGitRoot } from "@vortex/git";
import { chunkFile, LocalEmbedder, VectorStore } from "@vortex/retrieval";
import * as path from "path";

export class Indexer {
  private embedder: LocalEmbedder;
  private store: VectorStore;

  constructor() {
    this.embedder = new LocalEmbedder();
    this.store = new VectorStore();
  }

  /**
   * Indexes all tracked files in the git repository.
   */
  async indexRepository(cwd: string): Promise<void> {
    if (!isGitRepo(cwd)) {
      throw new Error(`Directory ${cwd} is not a git repository.`);
    }

    const root = getGitRoot(cwd);
    console.log(`Starting indexing for repository at ${root}`);

    const files = listTrackedFiles(root).filter(file => {
      const ext = path.extname(file);
      return ['.ts', '.tsx', '.js', '.jsx'].includes(ext) && !file.includes('node_modules');
    });
    console.log(`Found ${files.length} supported source files.`);

    // In a real implementation we would filter out non-text files and use concurrency control
    // For now, we sequentially process each file for simplicity
    for (const file of files) {
      try {
        console.log(`Processing ${file}...`);
        const chunks = chunkFile(file);
        
        if (chunks.length === 0) {
          continue;
        }

        const embeddings = await this.embedder.embedChunks(chunks);
        await this.store.upsert(chunks, embeddings);
      } catch (err) {
        console.warn(`Failed to process ${file}:`, err);
      }
    }

    console.log("Indexing complete.");
  }

  /**
   * Semantically searches the indexed codebase.
   */
  async search(query: string, limit: number = 5): Promise<any[]> {
    console.log(`Generating embedding for query: "${query}"...`);
    // Create a dummy chunk to embed the query
    const queryEmbedding = await this.embedder.embedChunks([
      { 
        content: query, 
        file: "", 
        startLine: 0, 
        endLine: 0, 
        symbolPath: "",
        dependencies: [],
        id: "query",
        language: "text",
        name: "query",
        kind: "function",
        isExported: false,
        isAsync: false,
        hash: ""
      }
    ]);

    if (queryEmbedding.length === 0) {
        return [];
    }

    console.log(`Searching vector store...`);
    const embedding = queryEmbedding[0];
    if (!embedding) {
      return [];
    }
    const results = await this.store.search(embedding, limit);
    return results;
  }
}

export * from "./intelligence";
