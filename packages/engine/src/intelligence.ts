import { GoogleGenAI } from "@google/genai";
import { VectorStore, LocalEmbedder, BM25Index, HybridRetriever } from "@vortex/retrieval";
import { ReviewOrchestrator } from "./agents/orchestrator";
import { OrchestratedReview, AgentContextChunk } from "./agents/types";

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

  private async generateWithRetry(prompt: string, retries = 5): Promise<string> {
    for (let i = 0; i < retries; i++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("API Request Timeout")), 120000)
        );
        const response: any = await Promise.race([
          this.client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
          }),
          timeoutPromise
        ]);
        return response.text || "";
      } catch (err: any) {
        if (err.status === 503 || err.status === 429) {
          const delay = Math.pow(2, i) * 2000;
          console.warn(`\n[API Busy] Error ${err.status}: ${err.message}. Retrying in ${delay / 1000} seconds...`);
          await new Promise(res => setTimeout(res, delay));
        } else {
          throw err;
        }
      }
    }
    throw new Error("Failed to generate content after maximum retries.");
  }

  /**
   * Extracts search queries (keywords, function names, classes) from a PR diff.
   */
  async extractSearchQueriesFromDiff(diff: string): Promise<string[]> {
    const prompt = `
You are an expert code analyzer. 
Analyze the following git diff and extract exactly 3 short search queries.
These queries should be the names of the most important functions, classes, or architectural concepts that are modified or referenced in this PR.
Your goal is to extract queries that can be used in a vector search engine to find the relevant codebase context.

Return ONLY a valid JSON array of 3 strings. No markdown formatting, no explanation.

Diff:
\`\`\`diff
${diff}
\`\`\`
    `;

    try {
      let result = await this.generateWithRetry(prompt);
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
   * Generates a context-aware RAG code review for a given PR diff.
   */
  async generateRAGReview(diff: string, chunks: any[]): Promise<string> {
    const contextStr = chunks.map((c, i) => {
      return `[Context Chunk ${i+1}] File: ${c.file} | Symbol: ${c.symbolPath || 'N/A'}
Code:
${c.content}`;
    }).join('\n\n---\n\n');

    const prompt = `
You are an expert Principal Software Engineer reviewing a pull request.
You have been provided with the git diff of the pull request, AND some relevant code chunks from the existing codebase for context.

Your task is to analyze the PR diff and compare it against the provided codebase context to determine if it is SAFE to merge.
Focus on:
1. Architectural consistency with the provided codebase context.
2. Logic errors or integration issues.
3. Does this break existing functionality shown in the chunks?

At the end of your review, you MUST explicitly state whether the PR is "SAFE TO MERGE" or "REQUIRES CHANGES".

Pull Request Diff:
\`\`\`diff
${diff}
\`\`\`

Existing Codebase Context:
${contextStr}

Format your review beautifully with markdown.
    `;

    const result = await this.generateWithRetry(prompt);
    return result || "No review generated.";
  }

  public async generateIssueAnalysis(issueTitle: string, issueBody: string, comments: any[], relevantContext: any[]): Promise<string> {
    const prompt = `You are a Principal Software Architect analyzing a bug report or feature request.

# Issue Info
Title: ${issueTitle}
Body: ${issueBody || 'No description provided.'}
Discussion Thread:
${comments.map((c, i) => `Comment ${i + 1} (@${c.user?.login}): ${c.body}`).join('\n')}

# Relevant Local Context
I have scanned the local codebase and found the following relevant code chunks that might be related to this issue:
${relevantContext.map((c, i) => `--- Chunk ${i + 1} (${c.file} - ${c.symbolPath || 'anonymous'}) ---\n${c.content}`).join('\n\n')}

# Your Task
1. Diagnose the issue: Briefly summarize the problem or request based on the issue description and discussion.
2. Formulate a Plan: Given the local context provided, propose a concrete, step-by-step architectural plan to fix the bug or implement the feature.
3. Code Suggestions: Provide actual code snippets showing what lines in the relevant files need to be modified.

Use heavy markdown formatting (bolding, lists, code blocks with syntax highlighting) and emojis to make your analysis highly readable. Focus on being deeply technical and actionable.
`;
    return this.generateWithRetry(prompt);
  }

  /**
   * Suggests optimizations and refactoring for a single file.
   */
  async generateSuggestions(fileContent: string): Promise<string> {
    const prompt = `
You are an AI pair programmer. Review the following code file and suggest improvements.
Look for:
1. Better abstractions
2. Performance optimizations
3. Code readability enhancements

File Content:
\`\`\`
${fileContent}
\`\`\`
    `;

    const result = await this.generateWithRetry(prompt);
    return result || "No suggestions generated.";
  }

  /**
   * Automatically fixes nitbits in the provided file content.
   */
  async autoFix(fileContent: string): Promise<string> {
    const prompt = `
You are an automated code formatter and fixer.
Fix any obvious linting errors, formatting inconsistencies, or minor nitbits in the following code.
Return ONLY the completely fixed code, with no surrounding markdown or explanation, so it can be directly saved to the file.

Code:
\`\`\`
${fileContent}
\`\`\`
    `;

    let fixedCode = await this.generateWithRetry(prompt);
    if (!fixedCode) return fileContent;
    
    // Strip markdown formatting if the model still outputs it
    if (fixedCode.startsWith("\`\`\`")) {
      fixedCode = fixedCode.replace(/^\`\`\`[a-z]*\n/, "").replace(/\n\`\`\`$/, "");
    }

    return fixedCode;
  }

  /**
   * Generates a basic code review for a PR diff without requiring context chunks.
   */
  async generateReview(diff: string): Promise<string> {
    const prompt = `
You are an expert Principal Software Engineer reviewing a pull request.
You have been provided with the git diff of the pull request.

Your task is to analyze the PR diff and provide a thorough code review.
Focus on:
1. Code quality and adherence to best practices
2. Potential bugs or logic errors
3. Performance implications
4. Security considerations
5. Design patterns and architecture

At the end of your review, you MUST explicitly state whether the PR is "SAFE TO MERGE" or "REQUIRES CHANGES".

Pull Request Diff:
\`\`\`diff
${diff}
\`\`\`

Format your review beautifully with markdown.
    `;

    const result = await this.generateWithRetry(prompt);
    return result || "No review generated.";
  }

  /**
   * Performs Retrieval-Augmented Generation (RAG) by answering a query
   * based on the provided code chunks.
   */
  async answerQueryWithContext(query: string, chunks: any[]): Promise<string> {
    const contextStr = chunks.map((c, i) => {
      return `[Chunk ${i+1}] File: ${c.file} | Symbol: ${c.symbolPath || 'N/A'}
Code:
${c.content}`;
    }).join('\n\n---\n\n');

    const prompt = `You are the Vortex Intelligence Engine, an expert Principal Software Engineer.
The user has asked you a question about the codebase. 

I have retrieved the most semantically relevant code chunks from the repository for you to reference. 
Using ONLY these code chunks, answer the user's question with deep technical insight and extreme clarity.

USER QUESTION:
${query}

RELEVANT CODE CHUNKS:
${contextStr}

Your answer must follow these strict guidelines:
1. **Depth & Clarity**: Explain the 'how' and the 'why', not just the 'what'. Break down the logic step-by-step.
2. **Citations**: Whenever you mention a specific function, class, or logic, cite the exact filename and symbol (e.g., \`testEmbeddings()\` in \`test_embed.ts\`).
3. **Rich Formatting**: Use heavy markdown formatting to make the response beautiful in a terminal. Use H2/H3 headers for sections, bold text for emphasis, bullet points, and syntax-highlighted code blocks where helpful.
4. **Professional Tone**: Sound like a highly experienced senior engineer mentoring a junior. Use emojis sparingly but effectively (e.g., 💡 for tips, ⚠️ for warnings).
5. If the provided chunks do not contain enough information to answer fully, explicitly state what is missing.
`;

    return await this.generateWithRetry(prompt);
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
