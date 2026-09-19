import { Chunk, ChunkKind } from "./chunker";

/**
 * Result from the retrieval pipeline with provenance and scoring.
 *
 * This replaces the previous pattern of mutating Chunk objects
 * with arbitrary `score` fields and using `any` to bypass typing.
 */
export interface RetrievalResult {
  chunk: Chunk;
  /** Final relevance score after fusion/reranking */
  score: number;
  /** Which retrieval method contributed this result */
  source: RetrievalSource;
  /** Rank position in the final results (1-indexed) */
  rank?: number;
}

export type RetrievalSource = "vector" | "bm25" | "graph" | "hybrid" | "reranker";

/**
 * File classification for the indexing pipeline.
 */
export type FileCategory =
  | "source"
  | "test"
  | "documentation"
  | "configuration"
  | "localization"
  | "lockfile"
  | "generated"
  | "asset"
  | "unknown";

/**
 * Strategy for how a file should be indexed.
 */
export type IndexStrategy =
  | "ast"
  | "structured"
  | "key-aware"
  | "metadata-only"
  | "fallback"
  | "skip";

/**
 * Classification result for a file in the repository.
 */
export interface FileClassification {
  /** What kind of file this is */
  category: FileCategory;
  /** Whether the file should be indexed at all */
  shouldIndex: boolean;
  /** Whether chunks should be embedded (lockfiles: no, source: yes) */
  shouldEmbed: boolean;
  /** Which indexing strategy to use */
  indexStrategy: IndexStrategy;
}

/**
 * Scored chunk used internally within retrieval methods.
 * Each retrieval method produces these before RRF fusion.
 */
export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  source: RetrievalSource;
}

/**
 * Configuration for the hybrid retrieval pipeline.
 */
export interface HybridRetrieverConfig {
  /** Number of candidates to fetch from each retrieval method before merging (default: 20) */
  candidatesPerMethod?: number;
  /** Final number of results after reranking (default: 10) */
  topK?: number;
  /** Whether to use the cross-encoder reranker (default: true) */
  useReranker?: boolean;
  /** Whether to retrieve dependency graph neighbors (default: true) */
  useGraph?: boolean;
  /** Whether to expand parent context after reranking (default: false) */
  expandParentContext?: boolean;
}
