import { BaseAgent } from "./base-agent";
import {
  AgentInput,
  AgentOutput,
  ArchitectureOutput,
  ArchitectureOutputSchema,
} from "./types";
import { Prompts } from "@vortex/shared";

/**
 * ArchitectureAgent — Specialized codebase architecture reviewer.
 *
 * Compares PR changes against the existing codebase context to identify:
 * - Pattern violations (e.g., introducing callbacks where the codebase uses async/await)
 * - Breaking API contract changes
 * - Naming convention inconsistencies
 * - Dependency direction violations
 * - Missing abstractions or premature abstractions
 * - Inconsistent error handling strategies
 *
 * Returns structured ArchitectureFinding[] with severity levels and alignment recommendations.
 */
export class ArchitectureAgent extends BaseAgent {
  readonly name = "ArchitectureAgent";

  readonly systemPrompt = Prompts.architectureSystemPrompt;

  protected buildPrompt(input: AgentInput): string {
    let prompt = `## PR Diff to Review\n\`\`\`diff\n${input.diff}\n\`\`\`\n`;

    if (input.contextChunks.length > 0) {
      prompt += `\n## Existing Codebase Architecture (Retrieved Context)\nThese are the most relevant code chunks from the existing codebase. Compare the PR diff against these patterns:\n`;
      input.contextChunks.forEach((chunk, i) => {
        prompt += `\n### Context ${i + 1}: ${chunk.file} → ${chunk.symbolPath} (${chunk.kind})\n\`\`\`\n${chunk.content}\n\`\`\`\n`;
      });
    } else {
      prompt += `\n## Note\nNo existing codebase context was retrieved. Evaluate the PR diff on its own merits, focusing on internal consistency and general best practices.\n`;
    }

    if (input.memories && input.memories.length > 0) {
      prompt += `\n## Historical Architecture Context\nThese are relevant findings from past reviews:\n`;
      input.memories.forEach((mem, i) => {
        prompt += `- Memory ${i + 1}: ${mem}\n`;
      });
    }

    return prompt;
  }

  protected parseOutput(rawResponse: string): AgentOutput {
    const parsed = this.extractJSON<ArchitectureOutput>(rawResponse);

    if (parsed) {
      const validated = ArchitectureOutputSchema.safeParse(parsed);

      if (validated.success) {
        return {
          agentName: this.name,
          findings: validated.data.findings,
          summary: validated.data.summary,
          consistencyScore: validated.data.consistencyScore,
        } as AgentOutput & { consistencyScore: string };
      }
    }

    // Fallback
    return {
      agentName: this.name,
      findings: [],
      summary: rawResponse.slice(0, 500),
      consistencyScore: "good",
    } as AgentOutput & { consistencyScore: string };
  }
}
