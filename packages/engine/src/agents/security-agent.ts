import { BaseAgent } from "./base-agent";
import {
  AgentInput,
  AgentOutput,
  SecurityOutput,
  SecurityOutputSchema,
} from "./types";
import { Prompts } from "@vortex/shared";

/**
 * SecurityAgent — Specialized security vulnerability scanner.
 *
 * Analyzes PR diffs for:
 * - Injection vulnerabilities (SQL, XSS, command injection)
 * - Hardcoded secrets and API keys
 * - Unsafe deserialization
 * - Path traversal attacks
 * - Insecure cryptographic practices
 * - Missing input validation
 * - SSRF (Server-Side Request Forgery)
 *
 * Returns structured SecurityFinding[] with severity levels and fix recommendations.
 */
export class SecurityAgent extends BaseAgent {
  readonly name = "SecurityAgent";

  readonly systemPrompt = Prompts.securitySystemPrompt;

  protected buildPrompt(input: AgentInput): string {
    let prompt = `## PR Diff to Review\n\`\`\`diff\n${input.diff}\n\`\`\`\n`;

    if (input.contextChunks.length > 0) {
      prompt += `\n## Existing Codebase Context\nUse this to understand what security patterns the codebase already uses:\n`;
      input.contextChunks.forEach((chunk, i) => {
        prompt += `\n### Context ${i + 1}: ${chunk.file} → ${chunk.symbolPath}\n\`\`\`${chunk.kind}\n${chunk.content}\n\`\`\`\n`;
      });
    }

    if (input.memories && input.memories.length > 0) {
      prompt += `\n## Historical Security Context\nThese are relevant findings from past reviews:\n`;
      input.memories.forEach((mem, i) => {
        prompt += `- Memory ${i + 1}: ${mem}\n`;
      });
    }

    return prompt;
  }

  protected parseOutput(rawResponse: string): AgentOutput {
    const parsed = this.extractJSON<SecurityOutput>(rawResponse);

    if (parsed) {
      // Validate with Zod (non-throwing — coerce to defaults on failure)
      const validated = SecurityOutputSchema.safeParse(parsed);

      if (validated.success) {
        return {
          agentName: this.name,
          findings: validated.data.findings,
          summary: validated.data.summary,
          riskLevel: validated.data.riskLevel,
        } as AgentOutput & { riskLevel: string };
      }
    }

    // Fallback: return the raw response as summary if JSON parsing fails
    return {
      agentName: this.name,
      findings: [],
      summary: rawResponse.slice(0, 500),
      riskLevel: "low_risk",
    } as AgentOutput & { riskLevel: string };
  }
}
