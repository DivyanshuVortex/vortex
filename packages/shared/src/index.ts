export interface CodeChunk {
  id: string;
  file: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
}

export interface ReviewResult {
  status: "SAFE_TO_MERGE" | "REQUIRES_CHANGES" | "NEEDS_REVIEW";
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

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^.]+)/);
  if (match && match.length >= 3) {
    return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}
