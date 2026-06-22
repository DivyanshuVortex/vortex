import { z } from "zod";

// ─────────────────────────────────────────────
// Agent Input / Output Types
// ─────────────────────────────────────────────

/**
 * Input provided to every agent in the pipeline.
 */
export interface AgentInput {
  /** The raw PR diff being reviewed */
  diff: string;
  /** Relevant code chunks retrieved via hybrid search */
  contextChunks: AgentContextChunk[];
  /** Outputs from previously-run agents (for chaining) */
  previousOutputs?: Record<string, any>;
  /** Relevant memories from past reviews */
  memories?: string[];
}

export interface AgentContextChunk {
  file: string;
  symbolPath: string;
  content: string;
  kind: string;
}

/**
 * Base output that every agent must produce.
 */
export interface AgentOutput {
  agentName: string;
  findings: any[];
  summary: string;
}

// ─────────────────────────────────────────────
// Autonomous Agent State Types
// ─────────────────────────────────────────────

export interface AgentState {
  evidence: {
    filesRead: string[];
    symbolsObserved: string[];
    dependenciesObserved: string[];
    externalSchemasFound: Record<string, string>;
    confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  plan: {
    steps: string[];
    currentStepIndex: number;
    completedSteps: string[];
  };
  execution: {
    filesModified: string[];
    commandsRun: string[];
    lastError: string | null;
    consecutiveFailures: number;
  };
  verification: {
    contractItems: string[];
    passed: string[];
    failed: string[];
  };
  verdict: 'IN_PROGRESS' | 'COMPLETE' | 'INCOMPLETE';
}

// ─────────────────────────────────────────────
// Security Agent Types
// ─────────────────────────────────────────────

export const SecuritySeverity = z.enum(["critical", "high", "medium", "low", "info"]);
export type SecuritySeverity = z.infer<typeof SecuritySeverity>;

export const SecurityFindingSchema = z.object({
  title: z.string().describe("Short title of the security finding"),
  severity: SecuritySeverity,
  description: z.string().describe("Detailed explanation of the vulnerability"),
  file: z.string().describe("File where the issue was found, or 'N/A'"),
  lineHint: z.string().optional().describe("Approximate line or code snippet"),
  recommendation: z.string().describe("How to fix this issue"),
});

export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

export const SecurityOutputSchema = z.object({
  findings: z.array(SecurityFindingSchema),
  summary: z.string().describe("1-2 sentence overall security assessment"),
  riskLevel: z.enum(["safe", "low_risk", "medium_risk", "high_risk", "critical_risk"]),
});

export type SecurityOutput = z.infer<typeof SecurityOutputSchema>;

// ─────────────────────────────────────────────
// Architecture Agent Types
// ─────────────────────────────────────────────

export const ArchitectureSeverity = z.enum(["breaking", "major", "minor", "suggestion"]);
export type ArchitectureSeverity = z.infer<typeof ArchitectureSeverity>;

export const ArchitectureFindingSchema = z.object({
  title: z.string().describe("Short title of the architecture finding"),
  severity: ArchitectureSeverity,
  description: z.string().describe("Detailed explanation of the architectural concern"),
  affectedPattern: z.string().describe("Which existing pattern or convention is affected"),
  recommendation: z.string().describe("How to align with the existing architecture"),
});

export type ArchitectureFinding = z.infer<typeof ArchitectureFindingSchema>;

export const ArchitectureOutputSchema = z.object({
  findings: z.array(ArchitectureFindingSchema),
  summary: z.string().describe("1-2 sentence overall architecture assessment"),
  consistencyScore: z.enum(["excellent", "good", "fair", "poor"]),
});

export type ArchitectureOutput = z.infer<typeof ArchitectureOutputSchema>;

// ─────────────────────────────────────────────
// Synthesizer Agent Types
// ─────────────────────────────────────────────

export const ReviewVerdictSchema = z.enum(["SAFE_TO_MERGE", "REQUIRES_CHANGES", "NEEDS_DISCUSSION"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const SynthesisOutputSchema = z.object({
  verdict: ReviewVerdictSchema,
  summary: z.string().describe("Executive summary of the entire review"),
  criticalIssues: z.array(z.string()).describe("Issues that MUST be fixed before merge"),
  suggestions: z.array(z.string()).describe("Non-blocking improvements"),
  markdownReport: z.string().describe("Full beautifully formatted markdown review report"),
});

export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;

// ─────────────────────────────────────────────
// Orchestrated Review — Final Combined Result
// ─────────────────────────────────────────────

export interface OrchestratedReview {
  /** Final verdict */
  verdict: ReviewVerdict;
  /** Full markdown report from the synthesizer */
  markdownReport: string;
  /** Executive summary */
  summary: string;
  /** Individual agent outputs for detailed inspection */
  agentOutputs: {
    security: SecurityOutput;
    architecture: ArchitectureOutput;
    synthesis: SynthesisOutput;
  };
  /** How long the full review took (ms) */
  durationMs: number;
}
