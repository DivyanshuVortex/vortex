import { Chunk } from "./chunker";
import { VectorStore } from "./store";
import { BM25Index } from "./bm25";
import { CrossEncoderReranker, ScoredChunk } from "./reranker";
import { LocalEmbedder } from "./embedder";
import { createQueryChunk } from "@vortex/shared";

/**
 * Configuration for the hybrid retrieval pipeline.
 */
export interface HybridRetrieverConfig {
  /** Number of candidates to fetch from each retrieval method before merging (default: 20) */
  candidatesPerMethod?: number;
  /** Final number of results after reranking (default: 10) */
  topK?: number;
  /** Whether to use the cross-encoder reranker (default: true). Disable for faster but less accurate results. */
  useReranker?: boolean;
  /** Whether to retrieve dependency graph neighbors (default: true). */
  useGraph?: boolean;
}

/**
 * Result from the hybrid retriever, including provenance information.
 */
export interface HybridSearchResult {
  chunk: Chunk;
  /** Final score after fusion/reranking */
  score: number;
  /** Which retrieval methods contributed this result */
  sources: ("vector" | "bm25" | "reranker" | "graph")[];
}

/**
 * HybridRetriever — 3-Stage Retrieval Pipeline
 *
 * Combines three retrieval strategies for maximum precision:
 *
 * ┌──────────────┐    ┌──────────────┐
 * │  Vector DB   │    │  BM25 Index  │
 * │ (Semantic)   │    │ (Keyword)    │
 * └──────┬───────┘    └──────┬───────┘
 *        │                   │
 *        └───────┬───────────┘
 *                │
 *     ┌──────────▼──────────┐
 *     │  Reciprocal Rank    │
 *     │  Fusion (RRF)       │
 *     └──────────┬──────────┘
 *                │
 *     ┌──────────▼──────────┐
 *     │  Cross-Encoder      │
 *     │  Reranker           │
 *     └──────────┬──────────┘
 *                │
 *          Top-K Results
 *
 * Stage 1 — Vector Search: Finds semantically similar code chunks.
 * Stage 2 — BM25 Search: Finds exact keyword matches (function names, etc.).
 * Stage 3 — Cross-Encoder: Reranks merged results for maximum accuracy.
 */
import { GraphRetriever } from "./graph";

export class HybridRetriever {
  private vectorStore: VectorStore;
  private bm25Index: BM25Index;
  private reranker: CrossEncoderReranker;
  private embedder: LocalEmbedder;
  private graphRetriever: GraphRetriever;

  constructor(
    vectorStore: VectorStore,
    bm25Index: BM25Index,
    embedder: LocalEmbedder
  ) {
    this.vectorStore = vectorStore;
    this.bm25Index = bm25Index;
    this.reranker = new CrossEncoderReranker();
    this.embedder = embedder;
    this.graphRetriever = new GraphRetriever();
  }

  /**
   * Performs hybrid search combining vector search, BM25, and cross-encoder reranking.
   *
   * @param query - The user's search query
   * @param config - Optional configuration for the retrieval pipeline
   * @returns Array of HybridSearchResult sorted by final relevance score
   */
  public async search(
    query: string,
    config?: HybridRetrieverConfig
  ): Promise<HybridSearchResult[]> {
    const candidatesPerMethod = config?.candidatesPerMethod ?? 20;
    const topK = config?.topK ?? 10;
    const useReranker = config?.useReranker ?? true;
    const useGraph = config?.useGraph ?? true;

    // Stage 1 & 2: Run vector search and BM25 in parallel
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearch(query, candidatesPerMethod),
      this.bm25Search(query, candidatesPerMethod),
    ]);

    // Stage 2.5: Graph Retrieval
    let graphResults: ScoredChunk[] = [];
    if (useGraph) {
      // Find the top chunks from the initial results to use as focal points
      const initialFused = this.reciprocalRankFusion(vectorResults, bm25Results, [], 5);
      const focalChunks = initialFused.map((r) => r.chunk);
      if (focalChunks.length > 0) {
        graphResults = await this.graphRetriever.getNeighbors(focalChunks, candidatesPerMethod);
      }
    }

    // Merge results using Reciprocal Rank Fusion
    const fusedResults = this.reciprocalRankFusion(
      vectorResults,
      bm25Results,
      graphResults,
      topK * 2 // Keep more candidates for the reranker
    );

    // Stage 3: Rerank with cross-encoder (if enabled and we have results)
    if (useReranker && fusedResults.length > 0) {
      const chunksToRerank = fusedResults.map((r) => r.chunk);
      const reranked = await this.reranker.rerank(query, chunksToRerank, topK);

      return reranked.map((scored) => {
        // Find which sources originally contributed this chunk
        const originalResult = fusedResults.find(
          (r) => r.chunk.id === scored.chunk.id
        );
        return {
          chunk: scored.chunk,
          score: scored.score,
          sources: [
            ...(originalResult?.sources ?? []),
            "reranker" as const,
          ],
        };
      });
    }

    return fusedResults.slice(0, topK);
  }

  /**
   * Vector search — finds semantically similar chunks using embeddings.
   */
  private async vectorSearch(
    query: string,
    limit: number
  ): Promise<ScoredChunk[]> {
    try {
      // Embed the query
      const queryEmbeddings = await this.embedder.embedChunks([
        createQueryChunk(query),
      ]);

      if (queryEmbeddings.length === 0 || !queryEmbeddings[0]) return [];

      const results = await this.vectorStore.search(
        queryEmbeddings[0],
        limit
      );

      return results.map((chunk: any) => ({
        chunk,
        score: chunk.score ?? 0,
        source: "vector" as const,
      }));
    } catch (err) {
      console.warn("[HybridRetriever] Vector search failed:", err);
      return [];
    }
  }

  /**
   * BM25 search — finds exact keyword matches.
   * Returns chunk objects by looking up IDs in the vector store.
   */
  private async bm25Search(
    query: string,
    limit: number
  ): Promise<ScoredChunk[]> {
    try {
      const bm25Results = this.bm25Index.search(query, limit);

      if (bm25Results.length === 0) return [];

      // Look up full chunk data from the database for each BM25 hit
      const { prisma } = await import("@vortex/db");
      const chunkIds = bm25Results.map((r) => r.id);

      const dbChunks = await prisma.chunk.findMany({
        where: { id: { in: chunkIds } },
      });

      const chunkMap = new Map(dbChunks.map((c: any) => [c.id, c]));

      const scoredChunks: ScoredChunk[] = [];

      for (const result of bm25Results) {
        const dbChunk = chunkMap.get(result.id);
        if (!dbChunk) continue;

        const chunk: Chunk = {
          id: dbChunk.id,
          file: dbChunk.file,
          language: dbChunk.language,
          name: dbChunk.name,
          symbolPath: dbChunk.symbolPath,
          kind: dbChunk.kind as any,
          parent: dbChunk.parent || undefined,
          isExported: dbChunk.isExported,
          isAsync: dbChunk.isAsync,
          signature: dbChunk.signature || undefined,
          dependencies: JSON.parse(dbChunk.dependencies) as string[],
          startLine: dbChunk.startLine,
          endLine: dbChunk.endLine,
          hash: dbChunk.hash,
          content: dbChunk.content,
        };

        scoredChunks.push({
          chunk,
          score: result.score,
          source: "bm25",
        });
      }

      return scoredChunks;
    } catch (err) {
      console.warn("[HybridRetriever] BM25 search failed:", err);
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) — merges results from multiple retrieval methods.
   *
   * RRF assigns each result a score based on its rank in each method:
   *   score(d) = Σ 1 / (k + rank(d))
   * where k is a constant (typically 60) that controls the diminishing return of lower ranks.
   *
   * This is superior to simple score normalization because it's robust to
   * score distribution differences between retrieval methods.
   */
  private reciprocalRankFusion(
    vectorResults: ScoredChunk[],
    bm25Results: ScoredChunk[],
    graphResults: ScoredChunk[],
    limit: number,
    k: number = 60
  ): HybridSearchResult[] {
    const scoreMap = new Map<
      string,
      { chunk: Chunk; score: number; sources: ("vector" | "bm25" | "graph")[] }
    >();

    // Score vector results by rank
    vectorResults.forEach((result, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scoreMap.get(result.chunk.id);

      if (existing) {
        existing.score += rrfScore;
        existing.sources.push("vector");
      } else {
        scoreMap.set(result.chunk.id, {
          chunk: result.chunk,
          score: rrfScore,
          sources: ["vector"],
        });
      }
    });

    // Score BM25 results by rank
    bm25Results.forEach((result, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scoreMap.get(result.chunk.id);

      if (existing) {
        existing.score += rrfScore;
        existing.sources.push("bm25");
      } else {
        scoreMap.set(result.chunk.id, {
          chunk: result.chunk,
          score: rrfScore,
          sources: ["bm25"],
        });
      }
    });

    // Score Graph results by rank
    graphResults.forEach((result, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scoreMap.get(result.chunk.id);

      if (existing) {
        existing.score += rrfScore;
        existing.sources.push("graph");
      } else {
        scoreMap.set(result.chunk.id, {
          chunk: result.chunk,
          score: rrfScore,
          sources: ["graph"],
        });
      }
    });

    // Sort by combined RRF score and return top results
    const fused = Array.from(scoreMap.values()).sort(
      (a, b) => b.score - a.score
    );

    return fused.slice(0, limit);
  }
}
