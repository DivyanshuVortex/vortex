import { Chunk } from "./chunker";
import { VectorStore } from "./store";
import { BM25Index } from "./bm25";
import { CrossEncoderReranker } from "./reranker";
import { LocalEmbedder } from "./embedder";
import { GraphRetriever } from "./graph";
import { createQueryChunk } from "@vortex/shared";
import {
  RetrievalResult,
  RetrievalSource,
  ScoredChunk,
  HybridRetrieverConfig,
} from "./types";

/**
 * HybridRetriever — Multi-Stage Retrieval Pipeline
 *
 * Combines multiple retrieval strategies for maximum precision:
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
 *     │  Graph Expansion    │
 *     └──────────┬──────────┘
 *                │
 *     ┌──────────▼──────────┐
 *     │  Cross-Encoder      │
 *     │  Reranker           │
 *     └──────────┬──────────┘
 *                │
 *          Top-K Results
 */
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
   * Performs hybrid search combining vector search, BM25, graph expansion,
   * and cross-encoder reranking.
   *
   * @param query - The user's search query
   * @param config - Optional configuration for the retrieval pipeline
   * @returns Array of RetrievalResult sorted by final relevance score
   */
  public async search(
    query: string,
    config?: HybridRetrieverConfig
  ): Promise<RetrievalResult[]> {
    const candidatesPerMethod = config?.candidatesPerMethod ?? 20;
    const topK = config?.topK ?? 10;
    const useReranker = config?.useReranker ?? true;
    const useGraph = config?.useGraph ?? true;

    // Stage 1: Parallel vector + BM25 search
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearch(query, candidatesPerMethod),
      this.bm25Search(query, candidatesPerMethod),
    ]);

    // Stage 2: Initial RRF fusion to find focal chunks for graph expansion
    let graphResults: ScoredChunk[] = [];
    if (useGraph) {
      const initialFused = this.reciprocalRankFusion(vectorResults, bm25Results, [], 5);
      const focalChunks = initialFused.map(r => r.chunk);
      if (focalChunks.length > 0) {
        graphResults = await this.graphRetriever.getNeighbors(focalChunks, candidatesPerMethod);
      }
    }

    // Stage 3: Full RRF fusion with graph results
    const fusedResults = this.reciprocalRankFusion(
      vectorResults,
      bm25Results,
      graphResults,
      topK * 2
    );

    // Stage 4: Cross-encoder reranking
    if (useReranker && fusedResults.length > 0) {
      const chunksToRerank = fusedResults.map(r => r.chunk);
      const reranked = await this.reranker.rerank(query, chunksToRerank, topK);

      return reranked.map((scored, rank) => {
        const originalResult = fusedResults.find(r => r.chunk.id === scored.chunk.id);
        return {
          chunk: scored.chunk,
          score: scored.score,
          source: "hybrid" as RetrievalSource,
          rank: rank + 1,
        };
      });
    }

    return fusedResults.slice(0, topK).map((r, rank) => ({
      ...r,
      rank: rank + 1,
    }));
  }

  /**
   * Vector search — finds semantically similar chunks using embeddings.
   */
  private async vectorSearch(
    query: string,
    limit: number
  ): Promise<ScoredChunk[]> {
    try {
      const queryEmbeddings = await this.embedder.embedChunks([
        createQueryChunk(query),
      ]);

      if (queryEmbeddings.length === 0 || !queryEmbeddings[0]) return [];

      const results = await this.vectorStore.search(queryEmbeddings[0], limit);

      return results.map(r => ({
        chunk: r.chunk,
        score: r.score,
        source: "vector" as RetrievalSource,
      }));
    } catch (err) {
      console.warn("[HybridRetriever] Vector search failed:", err);
      return [];
    }
  }

  /**
   * BM25 search — finds exact keyword matches.
   */
  private async bm25Search(
    query: string,
    limit: number
  ): Promise<ScoredChunk[]> {
    try {
      const bm25Results = this.bm25Index.search(query, limit);

      if (bm25Results.length === 0) return [];

      const { prisma } = await import("@vortex/db");
      const chunkIds = bm25Results.map(r => r.id);

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
   * where k is a constant (typically 60) that controls diminishing returns.
   */
  private reciprocalRankFusion(
    vectorResults: ScoredChunk[],
    bm25Results: ScoredChunk[],
    graphResults: ScoredChunk[],
    limit: number,
    k: number = 60
  ): RetrievalResult[] {
    const scoreMap = new Map<
      string,
      { chunk: Chunk; score: number; sources: RetrievalSource[] }
    >();

    const addResults = (results: ScoredChunk[], source: RetrievalSource) => {
      results.forEach((result, rank) => {
        const rrfScore = 1 / (k + rank + 1);
        const existing = scoreMap.get(result.chunk.id);

        if (existing) {
          existing.score += rrfScore;
          if (!existing.sources.includes(source)) {
            existing.sources.push(source);
          }
        } else {
          scoreMap.set(result.chunk.id, {
            chunk: result.chunk,
            score: rrfScore,
            sources: [source],
          });
        }
      });
    };

    addResults(vectorResults, "vector");
    addResults(bm25Results, "bm25");
    addResults(graphResults, "graph");

    const fused = Array.from(scoreMap.values()).sort(
      (a, b) => b.score - a.score
    );

    return fused.slice(0, limit).map((item, rank) => ({
      chunk: item.chunk,
      score: item.score,
      source: "hybrid" as RetrievalSource,
      rank: rank + 1,
    }));
  }
}
