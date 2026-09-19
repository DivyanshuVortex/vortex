import { prisma } from "@vortex/db";
import { Chunk, ChunkKind } from "./chunker";
import { RetrievalResult } from "./types";
import * as path from "path";
import * as fs from "fs";

// ─────────────────────────────────────────────
// HNSW Index (try native, graceful fallback)
// ─────────────────────────────────────────────

let HierarchicalNSW: any = null;
let hnswAvailable = false;

try {
  const hnswlib = require("hnswlib-node");
  HierarchicalNSW = hnswlib.HierarchicalNSW;
  hnswAvailable = true;
} catch {
  // hnswlib-node not available — fall back to brute-force
}

export interface SearchFilter {
  file?: string;
  kind?: ChunkKind;
}

const DEFAULT_DIMENSIONS = 384;  // MiniLM-L6-v2
const DEFAULT_MAX_ELEMENTS = 50000;
const HNSW_INDEX_FILE = ".vortex-hnsw.bin";

/**
 * VectorStore — Manages chunk embeddings in SQLite + HNSW ANN index.
 *
 * Embeddings are persisted in SQLite for durability.
 * HNSW index is an acceleration layer stored as `.vortex-hnsw.bin`.
 * Falls back to brute-force cosine similarity if HNSW is unavailable.
 */
export class VectorStore {
  private hnswIndex: any | null = null;
  private idToLabel: Map<string, number> = new Map();
  private labelToId: Map<number, string> = new Map();
  private nextLabel: number = 0;
  private dimensions: number;
  private maxElements: number;
  private indexDirty: boolean = false;

  constructor(dimensions: number = DEFAULT_DIMENSIONS) {
    this.dimensions = dimensions;
    this.maxElements = DEFAULT_MAX_ELEMENTS;
  }

  /**
   * Initialize or load the HNSW index.
   */
  public async initHnswIndex(rootDir?: string): Promise<void> {
    if (!hnswAvailable || !HierarchicalNSW) return;

    const indexPath = rootDir
      ? path.join(rootDir, HNSW_INDEX_FILE)
      : HNSW_INDEX_FILE;

    this.hnswIndex = new HierarchicalNSW("cosine", this.dimensions);

    // Try loading existing index
    if (fs.existsSync(indexPath)) {
      try {
        this.hnswIndex.readIndexSync(indexPath);
        await this.rebuildIdMaps();
        return;
      } catch {
        console.warn("[VectorStore] Failed to load HNSW index, will rebuild.");
      }
    }

    // Initialize fresh index
    this.hnswIndex.initIndex(this.maxElements);
  }

  /**
   * Rebuild ID maps from the database after loading HNSW index.
   */
  private async rebuildIdMaps(): Promise<void> {
    const allChunks = await prisma.chunk.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });

    this.idToLabel.clear();
    this.labelToId.clear();
    this.nextLabel = 0;

    for (const chunk of allChunks) {
      this.idToLabel.set(chunk.id, this.nextLabel);
      this.labelToId.set(this.nextLabel, chunk.id);
      this.nextLabel++;
    }
  }

  /**
   * Upsert chunks and their embeddings into both SQLite and HNSW.
   */
  public async upsert(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0 || chunks.length !== embeddings.length) {
      throw new Error("Chunks and embeddings length mismatch or empty.");
    }

    // DB upsert via Prisma transaction
    await prisma.$transaction(
      chunks.map((chunk, i) =>
        prisma.chunk.upsert({
          where: { id: chunk.id },
          update: {
            file: chunk.file,
            language: chunk.language,
            name: chunk.name,
            symbolPath: chunk.symbolPath,
            kind: chunk.kind,
            parent: chunk.parent || null,
            isExported: chunk.isExported,
            isAsync: chunk.isAsync,
            signature: chunk.signature || null,
            dependencies: JSON.stringify(chunk.dependencies),
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            hash: chunk.hash,
            content: chunk.content,
            embedding: JSON.stringify(embeddings[i]),
          },
          create: {
            id: chunk.id,
            file: chunk.file,
            language: chunk.language,
            name: chunk.name,
            symbolPath: chunk.symbolPath,
            kind: chunk.kind,
            parent: chunk.parent || null,
            isExported: chunk.isExported,
            isAsync: chunk.isAsync,
            signature: chunk.signature || null,
            dependencies: JSON.stringify(chunk.dependencies),
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            hash: chunk.hash,
            content: chunk.content,
            embedding: JSON.stringify(embeddings[i]),
          },
        })
      )
    );

    // HNSW upsert
    if (this.hnswIndex) {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const embedding = embeddings[i]!;

        let label = this.idToLabel.get(chunk.id);
        if (label === undefined) {
          label = this.nextLabel++;
          this.idToLabel.set(chunk.id, label);
          this.labelToId.set(label, chunk.id);

          // Resize if needed
          if (label >= this.maxElements) {
            this.maxElements = this.maxElements * 2;
            this.hnswIndex.resizeIndex(this.maxElements);
          }
        }

        this.hnswIndex.addPoint(embedding, label);
      }
      this.indexDirty = true;
    }
  }

  /**
   * Batch upsert with configurable sub-batch size.
   */
  public async upsertBatch(chunks: Chunk[], embeddings: number[][], batchSize: number = 100): Promise<void> {
    for (let i = 0; i < chunks.length; i += batchSize) {
      const chunkBatch = chunks.slice(i, i + batchSize);
      const embeddingBatch = embeddings.slice(i, i + batchSize);
      await this.upsert(chunkBatch, embeddingBatch);
    }
  }

  /**
   * Search for similar chunks. Uses HNSW if available, falls back to brute-force.
   */
  public async search(
    queryEmbedding: number[],
    limit: number = 10,
    filter?: SearchFilter
  ): Promise<RetrievalResult[]> {
    if (this.hnswIndex && this.labelToId.size > 0) {
      return this.searchHnsw(queryEmbedding, limit, filter);
    }
    return this.searchBruteForce(queryEmbedding, limit, filter);
  }

  /**
   * HNSW-accelerated search.
   */
  private async searchHnsw(
    queryEmbedding: number[],
    limit: number,
    filter?: SearchFilter
  ): Promise<RetrievalResult[]> {
    // Over-fetch to account for filtering
    const fetchLimit = filter ? Math.min(limit * 5, this.labelToId.size) : limit;

    const result = this.hnswIndex.searchKnn(queryEmbedding, fetchLimit);
    const chunkIds: string[] = [];

    for (const label of result.neighbors) {
      const id = this.labelToId.get(label);
      if (id) chunkIds.push(id);
    }

    if (chunkIds.length === 0) return [];

    // Fetch chunks from DB
    const whereClause: any = { id: { in: chunkIds } };
    if (filter?.file) whereClause.file = filter.file;
    if (filter?.kind) whereClause.kind = filter.kind;

    const dbChunks = await prisma.chunk.findMany({ where: whereClause });
    const chunkMap = new Map(dbChunks.map((c: any) => [c.id, c]));

    const results: RetrievalResult[] = [];
    for (let i = 0; i < chunkIds.length && results.length < limit; i++) {
      const id = chunkIds[i]!;
      const dbChunk = chunkMap.get(id);
      if (!dbChunk) continue;

      const chunk = this.dbChunkToChunk(dbChunk);
      const distance = result.distances[i] ?? 1;
      // hnswlib cosine distance = 1 - cosine_similarity
      const similarity = 1 - distance;

      results.push({
        chunk,
        score: similarity,
        source: "vector",
      });
    }

    return results;
  }

  /**
   * Brute-force search (fallback when HNSW is unavailable).
   */
  private async searchBruteForce(
    queryEmbedding: number[],
    limit: number,
    filter?: SearchFilter
  ): Promise<RetrievalResult[]> {
    const whereClause: any = {};
    if (filter?.file) whereClause.file = filter.file;
    if (filter?.kind) whereClause.kind = filter.kind;

    const dbChunks = await prisma.chunk.findMany({
      where: whereClause,
      take: 2000,
    });

    if (dbChunks.length === 0) return [];

    const scored = dbChunks.map((dbChunk: any) => {
      let similarity = -1;
      if (dbChunk.embedding) {
        try {
          const chunkEmbedding = JSON.parse(dbChunk.embedding) as number[];
          similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
        } catch {
          // Invalid embedding
        }
      }
      return { chunk: this.dbChunkToChunk(dbChunk), similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit).map((item, rank) => ({
      chunk: item.chunk,
      score: item.similarity,
      source: "vector" as const,
      rank: rank + 1,
    }));
  }

  public async getIdsByFile(file: string): Promise<string[]> {
    const chunks = await prisma.chunk.findMany({
      where: { file },
      select: { id: true },
    });
    return chunks.map(c => c.id);
  }

  public async deleteByFile(file: string): Promise<void> {
    // Remove from HNSW (mark for rebuild)
    if (this.hnswIndex) {
      const ids = await this.getIdsByFile(file);
      for (const id of ids) {
        const label = this.idToLabel.get(id);
        if (label !== undefined) {
          try {
            this.hnswIndex.markDelete(label);
          } catch {
            // Label might not exist in index
          }
          this.idToLabel.delete(id);
          this.labelToId.delete(label);
        }
      }
      this.indexDirty = true;
    }

    await prisma.chunk.deleteMany({ where: { file } });
  }

  /**
   * Persist the HNSW index to disk.
   */
  public saveHnswIndex(rootDir?: string): void {
    if (!this.hnswIndex || !this.indexDirty) return;

    const indexPath = rootDir
      ? path.join(rootDir, HNSW_INDEX_FILE)
      : HNSW_INDEX_FILE;

    try {
      this.hnswIndex.writeIndexSync(indexPath);
      this.indexDirty = false;
    } catch (err) {
      console.warn("[VectorStore] Failed to save HNSW index:", err);
    }
  }

  /**
   * Rebuild HNSW index from all stored embeddings in the database.
   */
  public async rebuildHnswFromDB(): Promise<number> {
    if (!hnswAvailable || !HierarchicalNSW) return 0;

    const allChunks = await prisma.chunk.findMany({
      select: { id: true, embedding: true },
      orderBy: { id: "asc" },
    });

    const validChunks = allChunks.filter((c: any) => c.embedding);

    this.maxElements = Math.max(DEFAULT_MAX_ELEMENTS, validChunks.length * 2);
    this.hnswIndex = new HierarchicalNSW("cosine", this.dimensions);
    this.hnswIndex.initIndex(this.maxElements);

    this.idToLabel.clear();
    this.labelToId.clear();
    this.nextLabel = 0;

    for (const dbChunk of validChunks) {
      try {
        const embedding = JSON.parse((dbChunk as any).embedding) as number[];
        const label = this.nextLabel++;
        this.idToLabel.set(dbChunk.id, label);
        this.labelToId.set(label, dbChunk.id);
        this.hnswIndex.addPoint(embedding, label);
      } catch {
        // Skip invalid embeddings
      }
    }

    this.indexDirty = true;
    return validChunks.length;
  }

  /**
   * Get total number of chunks in the database.
   */
  public async getChunkCount(): Promise<number> {
    return prisma.chunk.count();
  }

  /**
   * Load all chunks from DB (used for BM25 recovery).
   */
  public async loadAllChunks(): Promise<Chunk[]> {
    const dbChunks = await prisma.chunk.findMany();
    return dbChunks.map((c: any) => this.dbChunkToChunk(c));
  }

  // ─────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────

  private dbChunkToChunk(dbChunk: any): Chunk {
    return {
      id: dbChunk.id,
      file: dbChunk.file,
      language: dbChunk.language,
      name: dbChunk.name,
      symbolPath: dbChunk.symbolPath,
      kind: dbChunk.kind as ChunkKind,
      parent: dbChunk.parent || undefined,
      parentId: dbChunk.parentId || undefined,
      isExported: dbChunk.isExported,
      isAsync: dbChunk.isAsync,
      signature: dbChunk.signature || undefined,
      dependencies: JSON.parse(dbChunk.dependencies) as string[],
      startLine: dbChunk.startLine,
      endLine: dbChunk.endLine,
      hash: dbChunk.hash,
      content: dbChunk.content,
    };
  }
}

// ─────────────────────────────────────────────
// Cosine similarity (inline for fallback path)
// ─────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] as number) * (b[i] as number);
    normA += (a[i] as number) * (a[i] as number);
    normB += (b[i] as number) * (b[i] as number);
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
