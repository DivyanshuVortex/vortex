import { GoogleGenAI } from "@google/genai";
import { VectorStore, GeminiEmbedder } from "@vortex/retrieval";

export class IntelligenceAgent {
  private client: GoogleGenAI;
  private embedder: GeminiEmbedder;
  private store: VectorStore;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    this.client = new GoogleGenAI({ apiKey: key });
    this.embedder = new GeminiEmbedder(key);
    this.store = new VectorStore();
  }

  private async generateWithRetry(prompt: string, retries = 5): Promise<string> {
    for (let i = 0; i < retries; i++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("API Request Timeout")), 30000)
        );
        const response: any = await Promise.race([
          this.client.models.generateContent({
            model: "gemini-flash-latest",
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
   * Generates a code review for a given PR diff.
   */
  async generateReview(diff: string): Promise<string> {
    const prompt = `
You are an expert senior software engineer reviewing a pull request.
Analyze the following git diff and provide a constructive, thorough code review.
Focus on logic errors, architectural flaws, security issues, and performance optimizations.
Do not nitpick minor formatting if it's not a major issue.

Pull Request Diff:
\`\`\`diff
${diff}
\`\`\`
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
}
