import { BaseAgent } from "./base-agent";
import {
  AgentInput,
  AgentOutput,
  ArchitectureOutput,
  ArchitectureOutputSchema,
} from "./types";

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

  readonly systemPrompt = `You are a Principal Software Architect reviewing a pull request for ARCHITECTURAL CONSISTENCY.
Your ONLY job is to compare the PR diff against the provided codebase context chunks and identify architectural concerns.
You do NOT care about security vulnerabilities — a separate agent handles that.

Focus exclusively on:
1. Does the PR follow the existing patterns and conventions visible in the context chunks?
2. Does it break any existing API contracts or interfaces?
3. Are naming conventions consistent with the codebase?
4. Does the dependency direction make sense (e.g., core packages shouldn't depend on CLI packages)?
5. Is error handling consistent with existing patterns?
6. Are there missing or premature abstractions?

You must return your findings as a valid JSON object matching this exact schema:
{
  "findings": [
    {
      "title": "Short title",
      "severity": "breaking" | "major" | "minor" | "suggestion",
      "description": "Detailed explanation",
      "affectedPattern": "Which existing pattern is affected",
      "recommendation": "How to align with existing architecture"
    }
  ],
  "summary": "1-2 sentence overall architecture assessment",
  "consistencyScore": "excellent" | "good" | "fair" | "poor"
}

Severity Guide:
- breaking: Changes that will break existing consumers of an API or interface
- major: Significant pattern violations that make the code harder to maintain
- minor: Small inconsistencies that should ideally be fixed
- suggestion: Not a problem, but could be improved for better alignment

If the PR is architecturally consistent, return an empty findings array with consistencyScore "excellent".
Return ONLY the JSON object. No markdown. No explanation outside the JSON.`;

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
