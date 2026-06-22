import { BaseAgent } from "./base-agent";
import {
  AgentInput,
  AgentOutput,
  SynthesisOutput,
  SynthesisOutputSchema,
  SecurityOutput,
  ArchitectureOutput,
} from "./types";
import { Prompts } from "@vortex/shared";

/**
 * SynthesizerAgent — Combines all agent findings into a final review report.
 *
 * Receives outputs from Security and Architecture agents, and produces:
 * - A final verdict: SAFE_TO_MERGE, REQUIRES_CHANGES, or NEEDS_DISCUSSION
 * - A prioritized list of critical issues that must be fixed
 * - A list of non-blocking improvement suggestions
 * - A beautifully formatted markdown report for terminal display
 */
export class SynthesizerAgent extends BaseAgent {
  readonly name = "SynthesizerAgent";

  readonly systemPrompt = Prompts.synthesizerSystemPrompt;

  protected buildPrompt(input: AgentInput): string {
    const securityOutput = input.previousOutputs?.security as SecurityOutput | undefined;
    const architectureOutput = input.previousOutputs?.architecture as ArchitectureOutput | undefined;

    let prompt = `## PR Diff\n\`\`\`diff\n${input.diff}\n\`\`\`\n`;

    prompt += `\n## SecurityAgent Report\n`;
    if (securityOutput) {
      prompt += `Risk Level: ${securityOutput.riskLevel}\n`;
      prompt += `Summary: ${securityOutput.summary}\n`;
      prompt += `Findings:\n\`\`\`json\n${JSON.stringify(securityOutput.findings, null, 2)}\n\`\`\`\n`;
    } else {
      prompt += `No security analysis available.\n`;
    }

    prompt += `\n## ArchitectureAgent Report\n`;
    if (architectureOutput) {
      prompt += `Consistency Score: ${architectureOutput.consistencyScore}\n`;
      prompt += `Summary: ${architectureOutput.summary}\n`;
      prompt += `Findings:\n\`\`\`json\n${JSON.stringify(architectureOutput.findings, null, 2)}\n\`\`\`\n`;
    } else {
      prompt += `No architecture analysis available.\n`;
    }

    if (input.memories && input.memories.length > 0) {
      prompt += `\n## Historical Context (Past Reviews)\n`;
      input.memories.forEach((mem, i) => {
        prompt += `- ${mem}\n`;
      });
    }

    prompt += `\nSynthesize all the above into a final review. Return the JSON object as specified.`;

    return prompt;
  }

  protected parseOutput(rawResponse: string): AgentOutput {
    const parsed = this.extractJSON<SynthesisOutput>(rawResponse);

    if (parsed) {
      const validated = SynthesisOutputSchema.safeParse(parsed);

      if (validated.success) {
        return {
          agentName: this.name,
          findings: [
            ...validated.data.criticalIssues.map((issue) => ({
              type: "critical",
              description: issue,
            })),
            ...validated.data.suggestions.map((suggestion) => ({
              type: "suggestion",
              description: suggestion,
            })),
          ],
          summary: validated.data.summary,
          verdict: validated.data.verdict,
          criticalIssues: validated.data.criticalIssues,
          suggestions: validated.data.suggestions,
          markdownReport: validated.data.markdownReport,
        } as AgentOutput & SynthesisOutput;
      }
      
      // If validation failed but we have a parsed JSON object, do our best
      return {
        agentName: this.name,
        findings: [],
        summary: parsed.summary || "Review complete.",
        verdict: parsed.verdict || "NEEDS_DISCUSSION",
        criticalIssues: parsed.criticalIssues || [],
        suggestions: parsed.suggestions || [],
        markdownReport: parsed.markdownReport || `## Review Results\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``,
      } as AgentOutput & SynthesisOutput;
    }

    // Fallback: wrap the raw response in a basic structure
    return {
      agentName: this.name,
      findings: [],
      summary: "Review complete. See markdownReport for details.",
      verdict: "NEEDS_DISCUSSION",
      criticalIssues: [],
      suggestions: [],
      markdownReport: rawResponse,
    } as AgentOutput & SynthesisOutput;
  }
}
