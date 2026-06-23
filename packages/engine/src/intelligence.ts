import { GoogleGenAI } from "@google/genai";
import { VectorStore, LocalEmbedder, BM25Index, HybridRetriever } from "@vortex/retrieval";
import { ReviewOrchestrator } from "./agents/orchestrator";
import { OrchestratedReview, AgentContextChunk } from "./agents/types";
import { generateWithRetry } from "./llm";
import { execSync } from "child_process";
import * as crypto from "crypto";
import { Prompts } from "@vortex/shared";

export class IntelligenceAgent {
  private client: GoogleGenAI;
  private embedder: LocalEmbedder;
  private store: VectorStore;
  private orchestrator: ReviewOrchestrator;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    this.client = new GoogleGenAI({ apiKey: key });
    this.embedder = new LocalEmbedder();
    this.store = new VectorStore();
    this.orchestrator = new ReviewOrchestrator(key);
  }

  private async callLLM(prompt: string, cacheOpts?: { commitHash?: string, retrievalContextHash?: string, bypassCache?: boolean }): Promise<string> {
    const enabled = !cacheOpts?.bypassCache;
    return generateWithRetry(this.client, prompt, {
      label: "IntelligenceAgent",
      cache: {
        enabled,
        commitHash: cacheOpts?.commitHash,
        retrievalContextHash: cacheOpts?.retrievalContextHash
      }
    });
  }

  private getCurrentCommitHash(): string {
    try {
      const hash = execSync("git rev-parse HEAD", { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      const isDirty = execSync("git status --porcelain", { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().length > 0;
      return isDirty ? `${hash}-dirty` : hash;
    } catch {
      return "unknown";
    }
  }

  private computeChunksHash(chunks: any[]): string {
    if (!chunks || chunks.length === 0) return "";
    return crypto.createHash("sha256").update(chunks.map(c => c.id || c.file).join("|")).digest("hex");
  }

  /**
   * Extracts search queries (keywords, function names, classes) from a PR diff.
   */
  async extractSearchQueriesFromDiff(diff: string): Promise<string[]> {
    const prompt = Prompts.extractSearchQueries(diff);

    try {
      let result = await this.callLLM(prompt, { bypassCache: true });
      if (result.startsWith("\`\`\`")) {
        result = result.replace(/^\`\`\`[a-z]*\n/, "").replace(/\n\`\`\`$/, "");
      }
      const queries = JSON.parse(result);
      if (Array.isArray(queries)) {
        return queries;
      }
      return [];
    } catch (err) {
      console.warn("Failed to extract queries from diff:", err);
      return [];
    }
  }

  /**
   * Extracts web search queries from a task description.
   */
  async extractWebSearchQueries(task: string): Promise<string[]> {
    const prompt = Prompts.extractWebSearchQueries(task);

    try {
      let result = await this.callLLM(prompt, { bypassCache: true });
      if (result.startsWith("\`\`\`")) {
        result = result.replace(/^\`\`\`[a-z]*\n/, "").replace(/\n\`\`\`$/, "");
      }
      const queries = JSON.parse(result);
      if (Array.isArray(queries)) {
        return queries;
      }
      return [];
    } catch (err) {
      console.warn("Failed to extract web search queries:", err);
      return [];
    }
  }

  /**
   * Expands a single query into 3-5 variants for better retrieval recall.
   */
  async expandQuery(query: string): Promise<string[]> {
    const prompt = `You are a search query expansion assistant. 
Given the user query, generate 3-5 distinct, highly relevant search queries that capture different keywords or ways to express the intent.
Return ONLY a valid JSON array of strings.
Query: "${query}"`;

    try {
      let result = await this.callLLM(prompt, { bypassCache: false });
      if (result.startsWith("\`\`\`")) {
        result = result.replace(/^\`\`\`[a-z]*\n/, "").replace(/\n\`\`\`$/, "");
      }
      const queries = JSON.parse(result);
      if (Array.isArray(queries)) {
        return Array.from(new Set([query, ...queries])).slice(0, 5);
      }
      return [query];
    } catch (err) {
      console.warn("Failed to expand query:", err);
      return [query];
    }
  }

  /**
   * Generates a context-aware RAG code review for a given PR diff.
   */
  async generateRAGReview(diff: string, chunks: any[]): Promise<string> {
    const contextStr = chunks.map((c, i) => {
      return `[Context Chunk ${i + 1}] File: ${c.file} | Symbol: ${c.symbolPath || 'N/A'}
Code:
${c.content}`;
    }).join('\n\n---\n\n');

    const prompt = Prompts.ragReview(diff, contextStr);

    const result = await this.callLLM(prompt, {
      commitHash: this.getCurrentCommitHash(),
      retrievalContextHash: this.computeChunksHash(chunks)
    });
    return result || "No review generated.";
  }

  public async generateIssueAnalysis(issueTitle: string, issueBody: string, comments: any[], relevantContext: any[]): Promise<string> {
    const contextStr = relevantContext.map((c, i) => `--- Chunk ${i + 1} (${c.file} - ${c.symbolPath || 'anonymous'}) ---\n${c.content}`).join('\n\n');
    const commentsStr = comments.map((c, i) => `Comment ${i + 1} (@${c.user?.login}): ${c.body}`).join('\n');
    const prompt = Prompts.issueAnalysis(issueTitle, issueBody, commentsStr, contextStr);
    return this.callLLM(prompt, {
      commitHash: this.getCurrentCommitHash(),
      retrievalContextHash: this.computeChunksHash(relevantContext)
    });
  }



  async answerQueryWithContext(query: string, chunks: any[]): Promise<string> {
    const contextStr = chunks.map((c, i) => {
      return `[Chunk ${i + 1}] File: ${c.file} | Symbol: ${c.symbolPath || 'N/A'}
Code:
${c.content}`;
    }).join('\n\n---\n\n');

    const prompt = Prompts.answerQuery(query, contextStr);

    return await this.callLLM(prompt, {
      commitHash: this.getCurrentCommitHash(),
      retrievalContextHash: this.computeChunksHash(chunks)
    });
  }

  /**
   * Generates a detailed execution plan for a given task and context.
   * This is used to pre-plan autonomous agent runs.
   */
  public async generateExecutionPlan(task: string, contextChunks: any[]): Promise<string> {
    const contextStr = contextChunks.map((c, i) => {
      return `[Chunk ${i + 1}] File: ${c.file} | Symbol: ${c.symbolPath || 'N/A'}\nCode:\n${c.content}`;
    }).join('\n\n---\n\n');

    const prompt = Prompts.executionPlan(task, contextStr);

    let result = await this.callLLM(prompt, {
      commitHash: this.getCurrentCommitHash(),
      retrievalContextHash: this.computeChunksHash(contextChunks)
    });

    if (result.startsWith("\`\`\`")) {
      result = result.replace(/^\`\`\`[a-z]*\n/, "").replace(/\n\`\`\`$/, "");
    }
    return result;
  }

  /**
   * Generates a multi-agent code review using the ReviewOrchestrator.
   *
   * This is the upgraded version of generateRAGReview that uses:
   * - SecurityAgent: Scans for vulnerabilities
   * - ArchitectureAgent: Checks pattern consistency
   * - SynthesizerAgent: Combines findings into final verdict
   *
   * @param diff - The raw PR diff
   * @param chunks - Relevant codebase chunks from hybrid retrieval
   * @param memories - Optional relevant memories from past reviews
   * @returns Full OrchestratedReview with individual agent outputs
   */
  async generateMultiAgentReview(
    diff: string,
    chunks: any[],
    memories?: string[]
  ): Promise<OrchestratedReview> {
    const contextChunks: AgentContextChunk[] = chunks.map((c) => ({
      file: c.file,
      symbolPath: c.symbolPath || "anonymous",
      content: c.content,
      kind: c.kind || "unknown",
    }));

    return this.orchestrator.runReview(diff, contextChunks, memories);
  }
}
