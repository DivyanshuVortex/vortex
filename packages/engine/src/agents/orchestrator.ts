import { SecurityAgent } from "./security-agent";
import { ArchitectureAgent } from "./architecture-agent";
import { SynthesizerAgent } from "./synthesizer-agent";
import {
  AgentInput,
  AgentContextChunk,
  OrchestratedReview,
  SecurityOutput,
  ArchitectureOutput,
  SynthesisOutput,
} from "./types";
import { AgentTool } from "../tools/tool-types";

/**
 * ReviewOrchestrator — Multi-Agent Review Pipeline
 *
 * Coordinates specialized agents to produce a comprehensive PR review:
 *
 * ┌──────────────────────────────────────────────┐
 * │            ReviewOrchestrator                 │
 * │                                               │
 * │   ┌───────────────┐  ┌────────────────────┐  │
 * │   │ SecurityAgent │  │ ArchitectureAgent   │  │
 * │   │ (parallel)    │  │ (parallel)          │  │
 * │   └──────┬────────┘  └──────────┬─────────┘  │
 * │          │                      │             │
 * │          └──────────┬───────────┘             │
 * │                     │                         │
 * │          ┌──────────▼──────────┐              │
 * │          │ SynthesizerAgent    │              │
 * │          │ (sequential)        │              │
 * │          └──────────┬──────────┘              │
 * │                     │                         │
 * │              OrchestratedReview               │
 * └──────────────────────────────────────────────┘
 *
 * - Security + Architecture agents run in PARALLEL for speed
 * - Synthesizer runs AFTER both complete, receiving their outputs
 * - Memory injection happens before all agents run
 */
export class ReviewOrchestrator {
  private securityAgent: SecurityAgent;
  private architectureAgent: ArchitectureAgent;
  private synthesizerAgent: SynthesizerAgent;

  constructor(apiKey?: string) {
    this.securityAgent = new SecurityAgent(apiKey);
    this.architectureAgent = new ArchitectureAgent(apiKey);
    this.synthesizerAgent = new SynthesizerAgent(apiKey);
  }

  /**
   * Register tools across all agents that support self-verification.
   */
  public registerTools(tools: AgentTool[]): void {

    this.securityAgent.registerTools(tools);
    this.architectureAgent.registerTools(tools);

  }

  /**
   * Runs the full multi-agent review pipeline.
   *
   * @param diff - The raw PR diff text
   * @param contextChunks - Relevant codebase chunks from hybrid retrieval
   * @param memories - Optional relevant memories from past reviews
   * @returns Comprehensive OrchestratedReview with all agent outputs
   */
  public async runReview(
    diff: string,
    contextChunks: AgentContextChunk[],
    memories?: string[]
  ): Promise<OrchestratedReview> {
    const startTime = Date.now();

    const baseInput: AgentInput = {
      diff,
      contextChunks,
      memories,
    };

    console.log("\nRunning Security and Architecture agents in parallel...");

    const [securityResult, architectureResult] = await Promise.all([
      this.runAgentSafe("SecurityAgent", () =>
        this.securityAgent.run(baseInput)
      ),
      this.runAgentSafe("ArchitectureAgent", () =>
        this.architectureAgent.run(baseInput)
      ),
    ]);

    const securityOutput: SecurityOutput = {
      findings: securityResult.findings ?? [],
      summary: securityResult.summary,
      riskLevel: (securityResult as any).riskLevel ?? "low_risk",
    };

    const architectureOutput: ArchitectureOutput = {
      findings: architectureResult.findings ?? [],
      summary: architectureResult.summary,
      consistencyScore:
        (architectureResult as any).consistencyScore ?? "good",
    };

    console.log(
      `  Security: ${securityOutput.riskLevel} (${securityOutput.findings.length} findings)`
    );
    console.log(
      `  Architecture: ${architectureOutput.consistencyScore} (${architectureOutput.findings.length} findings)`
    );

    console.log("\nSynthesizing final review...");

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

    console.log(
      `\nReview complete in ${(durationMs / 1000).toFixed(1)}s | Verdict: ${synthesisOutput.verdict}`
    );

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
