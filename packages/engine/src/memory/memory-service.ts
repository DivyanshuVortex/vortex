import { prisma } from "@vortex/db";
import { LocalEmbedder } from "@vortex/retrieval";
import { cosineSimilarity, createQueryChunk } from "@vortex/shared";
import { OrchestratedReview } from "../agents/types";

/**
 * MemoryService — Persistent memory for the Vortex intelligence engine.
 *
 * Provides two types of memory:
 *
 * 1. **ReviewHistory** — Stores past PR review results. Allows queries like:
 *    "Have we seen a similar pattern flagged in past reviews?"
 *
 * 2. **Memory** — General-purpose memories (architectural decisions, known bugs,
 *    patterns). Supports both keyword and vector (embedding) search.
 *
 * Memory Flow:
 * ┌────────────┐     ┌──────────────┐     ┌────────────────┐
 * │ Review     │ ──▶ │ Store Memory │ ──▶ │  SQLite DB     │
 * │ Completes  │     │ & Embeddings │     │  (persistent)  │
 * └────────────┘     └──────────────┘     └────────┬───────┘
 *                                                   │
 * ┌────────────┐     ┌──────────────┐              │
 * │ New Review │ ◀── │ Recall       │ ◀────────────┘
 * │ Starts     │     │ Past Context │
 * └────────────┘     └──────────────┘
 */
export class MemoryService {
  private embedder: LocalEmbedder;

  constructor() {
    this.embedder = new LocalEmbedder();
  }

  // ─────────────────────────────────────────────
  // Store operations
  // ─────────────────────────────────────────────

  /**
   * Stores the results of a completed review in both ReviewHistory and Memory tables.
   * Called automatically after every `vortex review`.
   */
  async storeReviewMemory(
    prNumber: number,
    owner: string,
    repo: string,
    review: OrchestratedReview
  ): Promise<void> {
    // 1. Store in ReviewHistory for structured queries
    await prisma.reviewHistory.create({
      data: {
        prNumber,
        owner,
        repo,
        verdict: review.verdict,
        summary: review.summary,
        findings: JSON.stringify(review.agentOutputs),
      },
    });

    // 2. Create a memory entry with embeddings for semantic recall
    const memoryContent = this.buildMemoryContent(prNumber, owner, repo, review);
    const tags = this.extractTags(review);

    // Generate embedding for the memory
    let embedding: string | undefined;
    try {
      const embeddings = await this.embedder.embedChunks([
        createQueryChunk(memoryContent, "memory"),
      ]);
      if (embeddings[0]) {
        embedding = JSON.stringify(embeddings[0]);
      }
    } catch {
      // Embedding generation failed — store without embedding
    }

    await prisma.memory.create({
      data: {
        type: "review_summary",
        content: memoryContent,
        source: `PR #${prNumber} (${owner}/${repo})`,
        tags: JSON.stringify(tags),
        embedding,
      },
    });

    console.log(`  💾 Review memory stored for PR #${prNumber}`);
  }

  /**
   * Stores a general memory entry (e.g., architectural decision, known bug).
   */
  async storeMemory(
    type: "architectural_decision" | "known_bug" | "review_summary",
    content: string,
    source: string,
    tags: string[]
  ): Promise<void> {
    let embedding: string | undefined;
    try {
      const embeddings = await this.embedder.embedChunks([
        createQueryChunk(content, "memory"),
      ]);
      if (embeddings[0]) {
        embedding = JSON.stringify(embeddings[0]);
      }
    } catch {
      // Continue without embedding
    }

    await prisma.memory.create({
      data: { type, content, source, tags: JSON.stringify(tags), embedding },
    });
  }

  // ─────────────────────────────────────────────
  // Recall operations
  // ─────────────────────────────────────────────

  /**
   * Recalls relevant memories using semantic similarity search.
   * Used to inject historical context into agent prompts.
   */
  async recallRelevantMemories(
    query: string,
    limit: number = 5
  ): Promise<string[]> {
    // Generate embedding for the query
    let queryEmbedding: number[] | null = null;
    try {
      const embeddings = await this.embedder.embedChunks([
        createQueryChunk(query),
      ]);
      queryEmbedding = embeddings[0] ?? null;
    } catch {
      // Fallback to keyword search
    }

    const allMemories = await prisma.memory.findMany({
      select: {
        content: true,
        source: true,
        type: true,
        embedding: true,
      },
    });

    if (allMemories.length === 0) return [];

    // If we have a query embedding, rank by cosine similarity
    if (queryEmbedding) {
      const scored = allMemories
        .map((mem: any) => {
          let similarity = 0;
          if (mem.embedding) {
            try {
              const memEmbedding = JSON.parse(mem.embedding) as number[];
              similarity = cosineSimilarity(queryEmbedding!, memEmbedding);
            } catch {
              // Invalid embedding
            }
          }
          return { content: `[${mem.type}] (${mem.source}): ${mem.content}`, similarity };
        })
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, limit);

      return scored
        .filter((s: any) => s.similarity > 0.3) // Only return reasonably similar memories
        .map((s: any) => s.content);
    }

    // Fallback: return most recent memories
    const recent = await prisma.memory.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      select: { content: true, source: true, type: true },
    });

    return recent.map(
      (mem: any) => `[${mem.type}] (${mem.source}): ${mem.content}`
    );
  }

  /**
   * Retrieves past review history for a specific repository.
   */
  async getReviewHistory(
    owner: string,
    repo: string,
    limit: number = 10
  ): Promise<any[]> {
    return prisma.reviewHistory.findMany({
      where: { owner, repo },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
  }

  // ─────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────

  /**
   * Builds a human-readable memory content string from a review.
   */
  private buildMemoryContent(
    prNumber: number,
    owner: string,
    repo: string,
    review: OrchestratedReview
  ): string {
    const parts: string[] = [
      `Review of PR #${prNumber} in ${owner}/${repo}`,
      `Verdict: ${review.verdict}`,
      `Summary: ${review.summary}`,
    ];

    const { security, architecture } = review.agentOutputs;

    if (security.findings.length > 0) {
      parts.push(
        `Security issues: ${security.findings.map((f: any) => `${f.severity}: ${f.title}`).join("; ")}`
      );
    }

    if (architecture.findings.length > 0) {
      parts.push(
        `Architecture concerns: ${architecture.findings.map((f: any) => `${f.severity}: ${f.title}`).join("; ")}`
      );
    }

    return parts.join(". ");
  }

  /**
   * Extracts searchable tags from a review for keyword filtering.
   */
  private extractTags(review: OrchestratedReview): string[] {
    const tags: string[] = [review.verdict];

    const { security, architecture } = review.agentOutputs;

    if (security.riskLevel) tags.push(`risk:${security.riskLevel}`);
    if (architecture.consistencyScore) tags.push(`consistency:${architecture.consistencyScore}`);

    security.findings.forEach((f: any) => tags.push(`sec:${f.severity}`));
    architecture.findings.forEach((f: any) => tags.push(`arch:${f.severity}`));

    return tags;
  }

  // cosineSimilarity is now imported from @vortex/shared
}
