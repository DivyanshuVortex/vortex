import { isGitRepo, getGitRoot, listTrackedFiles } from "@vortex/git";
import { chunkFile, LocalEmbedder, VectorStore, BM25Index, scanFiles, HybridRetriever } from "@vortex/retrieval";
import { createQueryChunk, SUPPORTED_EXTENSIONS } from "@vortex/shared";
import * as path from "path";
import * as fs from "fs";
import { initDatabase, prisma } from "@vortex/db";

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
    let root = cwd;
    if (isGitRepo(cwd)) {
      try {
        root = getGitRoot(cwd);
      } catch {}
    }

    await initDatabase();

    let files: string[] = [];
    
    if (isGitRepo(cwd)) {
      try {
        const tracked = listTrackedFiles(root).filter(file => {
          const ext = path.extname(file);
          return SUPPORTED_EXTENSIONS.has(ext) && !file.includes('node_modules');
        });
        if (tracked.length > 0) {
          files = tracked;
        }
      } catch (e) {
        console.warn("Failed to list git-tracked files:", e);
      }
    }

    if (files.length === 0) {
      for await (const file of scanFiles(root)) {
        files.push(file);
      }
    }

    // Track which files we're processing for stale cleanup
    const processedFiles = new Set<string>();
    let totalChunks = 0;

    for (const file of files) {
      try {
        processedFiles.add(file);

        // Get existing chunk IDs for this file before processing
        const existingIds = await this.store.getIdsByFile(file);

        const chunks = chunkFile(file);

        if (chunks.length === 0) {
          // File produced no chunks — remove any stale ones
          if (existingIds.length > 0) {
            await this.store.deleteByFile(file);
            this.bm25Index.removeDocuments(existingIds);
          }
          continue;
        }

        const embeddings = await this.embedder.embedChunks(chunks);
        await this.store.upsert(chunks, embeddings);

        // Remove orphaned chunks (symbols deleted/renamed since last index)
        const newIds = new Set(chunks.map(c => c.id));
        const orphanedIds = existingIds.filter(id => !newIds.has(id));
        if (orphanedIds.length > 0) {
          for (const id of orphanedIds) {
            try {
              await prisma.chunk.delete({ where: { id } });
            } catch {}
          }
          this.bm25Index.removeDocuments(orphanedIds);
        }

        this.bm25Index.addDocuments(chunks);

        totalChunks += chunks.length;
      } catch (err) {
        console.warn(`Failed to process ${file}:`, err);
      }
    }

    // Clean up chunks from files that are no longer tracked
    try {
      const allDbFiles = await prisma.chunk.findMany({
        select: { file: true },
        distinct: ['file'],
      });
      for (const { file: dbFile } of allDbFiles) {
        if (!processedFiles.has(dbFile)) {
          const staleIds = await this.store.getIdsByFile(dbFile);
          if (staleIds.length > 0) {
            await this.store.deleteByFile(dbFile);
            this.bm25Index.removeDocuments(staleIds);
          }
        }
      }
    } catch (err) {
      console.warn("Failed to clean up stale file chunks:", err);
    }

    const bm25Path = path.join(cwd, ".vortex-bm25.json");
    try {
      const indexData = this.bm25Index.exportIndex();
      fs.writeFileSync(bm25Path, JSON.stringify(indexData));
    } catch (err) {
      console.warn("Failed to persist BM25 index:", err);
    }

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
    const queryEmbedding = await this.embedder.embedChunks([
      createQueryChunk(query),
    ]);

    if (queryEmbedding.length === 0) {
      return [];
    }

    if (process.env.DEBUG) console.log(`Searching vector store...`);
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
    if (this.bm25Index.documentCount === 0) {
      const bm25Path = path.join(process.cwd(), ".vortex-bm25.json");
      if (fs.existsSync(bm25Path)) {
        try {
          const data = JSON.parse(fs.readFileSync(bm25Path, "utf-8"));
          this.bm25Index.importIndex(data);
          if (process.env.DEBUG) console.log(`Loaded BM25 index (${this.bm25Index.documentCount} documents)`);
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

    if (process.env.DEBUG) console.log(`Running hybrid search for: "${query}"...`);
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
export * from "./agents/autonomous-agent";
export * from "./memory/memory-service";
export * from "./tools/tool-types";
export * from "./tools/grep-tool";
export * from "./tools/typecheck-tool";
export * from "./tools/file-read-tool";
export * from "./tools/file-write-tool";
export * from "./tools/file-edit-tool";
export * from "./tools/shell-execute-tool";
export * from "./tools/rag-search-tool";
export * from "./tools/web-search-tool";
export * from "./cache";
