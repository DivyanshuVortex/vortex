import { SynthesizerAgent } from "./synthesizer-agent";
import {
  AgentInput,
  AgentContextChunk,
  OrchestratedReview,
  SecurityOutput,
  ArchitectureOutput,
  SynthesisOutput,
  CombinedReviewOutputSchema,
  CombinedReviewOutput,
} from "./types";
import { AgentTool } from "../tools/tool-types";
import { generateStructured } from "../llm-structured";
import { GoogleGenAI } from "@google/genai";
import { Prompts } from "@vortex/shared";

/**
 * ReviewOrchestrator — Multi-Agent Review Pipeline
 *
 * Coordinates specialized agents to produce a comprehensive PR review:
 *
 * 1. Batched Security + Architecture Analysis (1 LLM call using Structured Output)
 * 2. Synthesis (1 LLM call)
 */
export class ReviewOrchestrator {
  private synthesizerAgent: SynthesizerAgent;
  private client: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    this.client = new GoogleGenAI({ apiKey: key });
    this.synthesizerAgent = new SynthesizerAgent(apiKey);
  }

  /**
   * Register tools across all agents that support self-verification.
   */
  public registerTools(tools: AgentTool[]): void {
    // Currently, ReviewOrchestrator doesn't use tools for the batched call, 
    // but we can pass them to synthesizer if needed in the future.
    this.synthesizerAgent.registerTools(tools);
  }

  /**
   * Runs the full multi-agent review pipeline.
   */
  public async runReview(
    diff: string,
    contextChunks: AgentContextChunk[],
    memories?: string[]
  ): Promise<OrchestratedReview> {
    const startTime = Date.now();

    if (process.env.DEBUG) console.log("\nRunning Batched Security + Architecture Review...");

    let combinedPrompt = `## PR Diff to Review\n\`\`\`diff\n${diff}\n\`\`\`\n`;

    if (contextChunks.length > 0) {
      combinedPrompt += `\n## Existing Codebase Context\nUse this to understand what patterns the codebase already uses:\n`;
      contextChunks.forEach((chunk, i) => {
        combinedPrompt += `\n### Context ${i + 1}: ${chunk.file} → ${chunk.symbolPath}\n\`\`\`${chunk.kind}\n${chunk.content}\n\`\`\`\n`;
      });
    }

    if (memories && memories.length > 0) {
      combinedPrompt += `\n## Historical Context\nThese are relevant findings from past reviews:\n`;
      memories.forEach((mem, i) => {
        combinedPrompt += `- Memory ${i + 1}: ${mem}\n`;
      });
    }

    combinedPrompt = Prompts.combinedReviewSystemPrompt + "\n\n" + combinedPrompt;

    let combinedResult: CombinedReviewOutput | null = null;
    try {
      combinedResult = await generateStructured<CombinedReviewOutput>(
        this.client,
        combinedPrompt,
        CombinedReviewOutputSchema,
        { label: "ReviewOrchestrator (Batched)", maxValidationRetries: 3 }
      );
    } catch (err) {
      console.error("\nBatched Review failed:", err);
    }

    const securityOutput: SecurityOutput = {
      findings: combinedResult?.securityFindings ?? [],
      summary: combinedResult?.securitySummary ?? "Security analysis encountered an error.",
      riskLevel: combinedResult?.securityRiskLevel ?? "low_risk",
    };

    const architectureOutput: ArchitectureOutput = {
      findings: combinedResult?.architectureFindings ?? [],
      summary: combinedResult?.architectureSummary ?? "Architecture analysis encountered an error.",
      consistencyScore: combinedResult?.architectureConsistencyScore ?? "good",
    };

    if (process.env.DEBUG) {
      console.log(`  Security: ${securityOutput.riskLevel} (${securityOutput.findings.length} findings)`);
      console.log(`  Architecture: ${architectureOutput.consistencyScore} (${architectureOutput.findings.length} findings)`);
      console.log("\nSynthesizing final review...");
    }

    const synthesisInput: AgentInput = {
      diff,
      contextChunks,
      memories,
      previousOutputs: {
        security: securityOutput,
        architecture: architectureOutput,
      },
    };

    const synthesisResult = await this.runAgentSafe(
      "SynthesizerAgent",
      () => this.synthesizerAgent.run(synthesisInput)
    );

    const synthesisOutput: SynthesisOutput = {
      verdict: (synthesisResult as any).verdict ?? "NEEDS_DISCUSSION",
      summary: synthesisResult.summary,
      criticalIssues: (synthesisResult as any).criticalIssues ?? [],
      suggestions: (synthesisResult as any).suggestions ?? [],
      markdownReport:
        (synthesisResult as any).markdownReport ??
        synthesisResult.summary,
    };

    const durationMs = Date.now() - startTime;

    if (process.env.DEBUG) {
      console.log(`\nReview complete in ${(durationMs / 1000).toFixed(1)}s | Verdict: ${synthesisOutput.verdict}`);
    }

    return {
      verdict: synthesisOutput.verdict,
      markdownReport: synthesisOutput.markdownReport,
      summary: synthesisOutput.summary,
      agentOutputs: {
        security: securityOutput,
        architecture: architectureOutput,
        synthesis: synthesisOutput,
      },
      durationMs,
    };
  }

  /**
   * Runs an agent with error handling — if an agent fails,
   * return a fallback output rather than crashing the entire pipeline.
   */
  private async runAgentSafe(
    agentName: string,
    fn: () => Promise<any>
  ): Promise<any> {
    try {
      return await fn();
    } catch (err) {
      console.error(`\n${agentName} failed:`, err);
      return {
        agentName,
        findings: [],
        summary: `${agentName} encountered an error and could not complete its analysis.`,
      };
    }
  }
}

