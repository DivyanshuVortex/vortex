// ─────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────

export interface CodeChunk {
  id: string;
  file: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
}

export interface ReviewResult {
  status: "SAFE_TO_MERGE" | "REQUIRES_CHANGES" | "NEEDS_DISCUSSION";
  summary: string;
  issues: string[];
  suggestions: string[];
}

export interface AnalysisContext {
  owner: string;
  repo: string;
  prNumber?: number;
  issueNumber?: number;
  filePath?: string;
}

// ─────────────────────────────────────────────
// Shared Error Class
// ─────────────────────────────────────────────

export class VortexError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = "VortexError";
  }
}

// ─────────────────────────────────────────────
// Shared Utilities
// ─────────────────────────────────────────────

/**
 * Parses a GitHub URL (SSH or HTTPS) to extract owner and repo.
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^.]+)/);
  if (match && match.length >= 3) {
    return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}

/**
 * Computes cosine similarity between two vectors.
 *
 * Used by both VectorStore (retrieval) and MemoryService (engine)
 * for comparing embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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

/**
 * Creates a minimal "query chunk" for embedding a text query.
 *
 * The embedding pipeline requires a full Chunk object, but for
 * query embedding we only need the content field. This factory
 * eliminates the boilerplate that was duplicated in 4+ places.
 */
export function createQueryChunk(content: string, id: string = "query") {
  return {
    content,
    file: "",
    startLine: 0,
    endLine: 0,
    symbolPath: "",
    dependencies: [] as string[],
    id,
    language: "text",
    name: id,
    kind: "function" as const,
    isExported: false,
    isAsync: false,
    hash: "",
  };
}
export * from "./prompts";
