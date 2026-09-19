import { isGitRepo, getGitRoot, listTrackedFiles } from "@vortex/git";
import {
  chunkFile,
  LocalEmbedder,
  VectorStore,
  BM25Index,
  scanFiles,
  HybridRetriever,
  classifyFile,
  Chunk,
  RetrievalResult,
  ScannedFile,
} from "@vortex/retrieval";
import { createQueryChunk, SUPPORTED_EXTENSIONS } from "@vortex/shared";
import * as path from "path";
import * as fs from "fs";
import { initDatabase, prisma } from "@vortex/db";

// ─────────────────────────────────────────────
// Batching constants
// ─────────────────────────────────────────────

const FILE_BATCH_SIZE = 20;
const EMBED_BATCH_SIZE = 50;
const DB_BATCH_SIZE = 100;

export interface IndexerOptions {
  onProgress?: (progress: { processed: number; total: number; elapsed: number; estimatedRemaining: number }) => void;
}

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
   *
   * Uses bounded batching for chunk processing, embedding generation, and DB writes.
   */
  async indexRepository(cwd: string, options?: IndexerOptions): Promise<{ filesProcessed: number; chunksIndexed: number; bm25Documents: number }> {
    let root = cwd;
    const startTime = Date.now();
    let filesProcessedCount = 0;
    if (isGitRepo(cwd)) {
      try {
        root = getGitRoot(cwd);
      } catch {}
    }

    await initDatabase();

    // Initialize HNSW index
    await this.store.initHnswIndex(root);

    // ── Discover files ──
    const scannedFiles: ScannedFile[] = [];

    if (isGitRepo(cwd)) {
      try {
        const tracked = listTrackedFiles(root);
        for (const file of tracked) {
          const classification = classifyFile(file);
          if (classification.shouldIndex) {
            scannedFiles.push({ path: file, classification });
          }
        }
      } catch (e) {
        console.warn("Failed to list git-tracked files:", e);
      }
    }

    if (scannedFiles.length === 0) {
      for await (const scanned of scanFiles(root)) {
        scannedFiles.push(scanned);
      }
    }

    // Track which files we're processing for stale cleanup
    const processedFiles = new Set<string>();
    let totalChunks = 0;

    // ── Process files in batches ──
    for (let i = 0; i < scannedFiles.length; i += FILE_BATCH_SIZE) {
      const batch = scannedFiles.slice(i, i + FILE_BATCH_SIZE);
      const allBatchChunks: Chunk[] = [];
      const batchFilePaths: string[] = [];

      // Parse all files in batch (CPU-bound, sequential is fine)
      for (const scanned of batch) {
        try {
          processedFiles.add(scanned.path);
          batchFilePaths.push(scanned.path);

          const chunks = chunkFile(scanned.path, scanned.classification);
          if (chunks.length === 0) {
            continue;
          }

          allBatchChunks.push(...chunks);
        } catch (err) {
          console.warn(`Failed to parse ${scanned.path}:`, err);
        }
      }

      if (allBatchChunks.length === 0) continue;

      // ── Handle stale chunks for files in this batch ──
      for (const filePath of batchFilePaths) {
        try {
          const existingIds = await this.store.getIdsByFile(filePath);
          const newIdsForFile = new Set(
            allBatchChunks.filter(c => c.file === filePath).map(c => c.id)
          );
          const orphanedIds = existingIds.filter(id => !newIdsForFile.has(id));

          if (orphanedIds.length > 0) {
            for (const id of orphanedIds) {
              try {
                await prisma.chunk.delete({ where: { id } });
              } catch {}
            }
            this.bm25Index.removeDocuments(orphanedIds);
          }

          // If file produced no chunks, clean up all existing
          if (newIdsForFile.size === 0 && existingIds.length > 0) {
            await this.store.deleteByFile(filePath);
            this.bm25Index.removeDocuments(existingIds);
          }
        } catch (err) {
          console.warn(`Failed to clean stale chunks for ${filePath}:`, err);
        }
      }

      // ── Embed in sub-batches ──
      for (let j = 0; j < allBatchChunks.length; j += EMBED_BATCH_SIZE) {
        const embedBatch = allBatchChunks.slice(j, j + EMBED_BATCH_SIZE);

        try {
          const embeddings = await this.embedder.embedChunks(embedBatch);
          // DB upsert in sub-batches
          await this.store.upsertBatch(embedBatch, embeddings, DB_BATCH_SIZE);
        } catch (err) {
          console.warn(`Failed to embed/store batch at offset ${j}:`, err);
        }
      }

      // BM25 update for entire batch
      this.bm25Index.addDocuments(allBatchChunks);
      totalChunks += allBatchChunks.length;
      
      filesProcessedCount += batch.length;
      if (options?.onProgress) {
        const elapsed = Date.now() - startTime;
        const timePerFile = elapsed / filesProcessedCount;
        const estimatedRemaining = timePerFile * (scannedFiles.length - filesProcessedCount);
        options.onProgress({ processed: filesProcessedCount, total: scannedFiles.length, elapsed, estimatedRemaining });
      }
    }

    // ── Clean up chunks from files that are no longer tracked ──
    try {
      const allDbFiles = await prisma.chunk.findMany({
        select: { file: true },
        distinct: ["file"],
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

    // ── Persist indices ──
    // Save BM25
    const bm25Path = path.join(root, ".vortex-bm25.json");
    try {
      const indexData = this.bm25Index.exportIndex();
      fs.writeFileSync(bm25Path, JSON.stringify(indexData));
    } catch (err) {
      console.warn("Failed to persist BM25 index:", err);
    }

    // Save HNSW
    this.store.saveHnswIndex(root);

    return {
      filesProcessed: scannedFiles.length,
      chunksIndexed: totalChunks,
      bm25Documents: this.bm25Index.documentCount,
    };
  }

  /**
   * Semantically searches the indexed codebase (vector-only, backward compatible).
   */
  async search(query: string, limit: number = 5): Promise<RetrievalResult[]> {
    if (process.env.DEBUG) console.log(`Generating embedding for query: "${query}"...`);
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
    return this.store.search(embedding, limit);
  }

  /**
   * Performs hybrid search using the multi-stage retrieval pipeline.
   * Combines vector search + BM25 keyword search + graph expansion + cross-encoder reranking.
   *
   * If BM25 index is empty, attempts to recover from persisted file or rebuild from DB.
   */
  async hybridSearch(query: string, limit: number = 10): Promise<RetrievalResult[]> {
    await initDatabase();

    // ── BM25 Recovery ──
    if (this.bm25Index.documentCount === 0) {
      const recovered = await this.recoverBM25Index();
      if (!recovered) {
        console.warn("[Indexer] BM25 index could not be recovered. Hybrid search will use vector-only.");
      }
    }

    // ── Initialize HNSW if needed ──
    try {
      await this.store.initHnswIndex(process.cwd());
    } catch {
      // HNSW not available, will use brute-force
    }

    const retriever = new HybridRetriever(
      this.store,
      this.bm25Index,
      this.embedder
    );

    if (process.env.DEBUG) console.log(`Running hybrid search for: "${query}"...`);
    return retriever.search(query, { topK: limit });
  }

  /**
   * Attempts to recover the BM25 index from persisted file or database.
   * Returns true if recovery was successful.
   */
  private async recoverBM25Index(): Promise<boolean> {
    // Try loading from persisted file first
    const bm25Path = path.join(process.cwd(), ".vortex-bm25.json");
    if (fs.existsSync(bm25Path)) {
      try {
        const data = JSON.parse(fs.readFileSync(bm25Path, "utf-8"));
        this.bm25Index.importIndex(data);
        if (this.bm25Index.documentCount > 0) {
          if (process.env.DEBUG) console.log(`Loaded BM25 index (${this.bm25Index.documentCount} documents)`);
          return true;
        }
      } catch (err) {
        console.warn("[Indexer] BM25 index file corrupt, rebuilding from database...");
      }
    }

    // Rebuild from database
    try {
      const allChunks = await this.store.loadAllChunks();
      if (allChunks.length > 0) {
        this.bm25Index.rebuild(allChunks);
        if (process.env.DEBUG) console.log(`Rebuilt BM25 index from database (${this.bm25Index.documentCount} documents)`);

        // Persist the recovered index
        try {
          fs.writeFileSync(bm25Path, JSON.stringify(this.bm25Index.exportIndex()));
        } catch {}

        return true;
      }
    } catch (err) {
      console.warn("[Indexer] Failed to rebuild BM25 from database:", err);
    }

    return false;
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
