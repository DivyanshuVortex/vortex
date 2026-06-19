import { listTrackedFiles, isGitRepo, getGitRoot } from "@vortex/git";
import { chunkFile, LocalEmbedder, VectorStore, BM25Index, HybridRetriever } from "@vortex/retrieval";
import { createQueryChunk } from "@vortex/shared";
import * as path from "path";
import * as fs from "fs";
import { initDatabase } from "@vortex/db";

export class Indexer {
  private embedder: LocalEmbedder;
  private store: VectorStore;
  private bm25Index: BM25Index;

  constructor() {
    this.embedder = new LocalEmbedder();
    this.store = new VectorStore();
    this.bm25Index = new BM25Index();
  }

  /**
   * Indexes all tracked files in the git repository.
   * Builds both the vector store (for semantic search) and the BM25 index (for keyword search).
   */
  async indexRepository(cwd: string): Promise<{ filesProcessed: number; chunksIndexed: number; bm25Documents: number }> {
    if (!isGitRepo(cwd)) {
      throw new Error(`Directory ${cwd} is not a git repository.`);
    }

    const root = getGitRoot(cwd);
    console.log(`Starting indexing for repository at ${root}`);

    // Ensure database tables are created in the local .vortex.db
    await initDatabase();

    const files = listTrackedFiles(root).filter(file => {
      const ext = path.extname(file);
      return ['.ts', '.tsx', '.js', '.jsx'].includes(ext) && !file.includes('node_modules');
    });
    console.log(`Found ${files.length} supported source files.`);

    let totalChunks = 0;

    for (const file of files) {
      try {
        console.log(`Processing ${file}...`);
        const chunks = chunkFile(file);
        
        if (chunks.length === 0) {
          continue;
        }

        // Build vector embeddings
        const embeddings = await this.embedder.embedChunks(chunks);
        await this.store.upsert(chunks, embeddings);

        // Add to BM25 keyword index
        this.bm25Index.addDocuments(chunks);

        totalChunks += chunks.length;
      } catch (err) {
        console.warn(`Failed to process ${file}:`, err);
      }
    }

    // Persist BM25 index to disk
    const bm25Path = path.join(cwd, ".vortex-bm25.json");
    try {
      const indexData = this.bm25Index.exportIndex();
      fs.writeFileSync(bm25Path, JSON.stringify(indexData));
      console.log(`BM25 index saved to ${bm25Path}`);
    } catch (err) {
      console.warn("Failed to persist BM25 index:", err);
    }

    console.log(`\nIndexing complete.`);
    console.log(`  📊 Files processed: ${files.length}`);
    console.log(`  🧩 Chunks indexed: ${totalChunks}`);
    console.log(`  📝 BM25 documents: ${this.bm25Index.documentCount}`);

    return {
      filesProcessed: files.length,
      chunksIndexed: totalChunks,
      bm25Documents: this.bm25Index.documentCount,
    };
  }

  /**
   * Semantically searches the indexed codebase (vector-only, backward compatible).
   */
  async search(query: string, limit: number = 5): Promise<any[]> {
    console.log(`Generating embedding for query: "${query}"...`);
    await initDatabase();
    // Create a dummy chunk to embed the query
    const queryEmbedding = await this.embedder.embedChunks([
      createQueryChunk(query),
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

  /**
   * Performs hybrid search using the 3-stage retrieval pipeline.
   * Combines vector search + BM25 keyword search + cross-encoder reranking.
   */
  async hybridSearch(query: string, limit: number = 10): Promise<any[]> {
    await initDatabase();
    // Load persisted BM25 index if the in-memory one is empty
    if (this.bm25Index.documentCount === 0) {
      const bm25Path = path.join(process.cwd(), ".vortex-bm25.json");
      if (fs.existsSync(bm25Path)) {
        try {
          const data = JSON.parse(fs.readFileSync(bm25Path, "utf-8"));
          this.bm25Index.importIndex(data);
          console.log(`Loaded BM25 index (${this.bm25Index.documentCount} documents)`);
        } catch (err) {
          console.warn("Failed to load BM25 index:", err);
        }
      }
    }

    const retriever = new HybridRetriever(
      this.store,
      this.bm25Index,
      this.embedder
    );

    console.log(`Running hybrid search for: "${query}"...`);
    const results = await retriever.search(query, { topK: limit });

    return results.map((r) => ({
      ...r.chunk,
      score: r.score,
      sources: r.sources,
    }));
  }
}

export * from "./intelligence";
export * from "./llm";
export * from "./agents/types";
export * from "./agents/base-agent";
export * from "./agents/security-agent";
export * from "./agents/architecture-agent";
export * from "./agents/synthesizer-agent";
export * from "./agents/orchestrator";
export * from "./memory/memory-service";
export * from "./tools/tool-types";
export * from "./tools/grep-tool";
export * from "./tools/typecheck-tool";
export * from "./tools/file-read-tool";

