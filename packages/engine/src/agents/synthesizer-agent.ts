import { BaseAgent } from "./base-agent";
import {
  AgentInput,
  AgentOutput,
  SynthesisOutput,
  SynthesisOutputSchema,
  SecurityOutput,
  ArchitectureOutput,
} from "./types";

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

  readonly systemPrompt = `You are a Staff Engineer writing the FINAL code review report for a pull request.
You have received analysis from two specialist agents:
1. **SecurityAgent** — found security vulnerabilities
2. **ArchitectureAgent** — found architectural concerns

Your job is to:
1. Synthesize ALL findings into a unified, prioritized review
2. Determine the final verdict: SAFE_TO_MERGE, REQUIRES_CHANGES, or NEEDS_DISCUSSION
3. Separate findings into "critical issues" (must fix) vs "suggestions" (nice to have)
4. Write a beautiful, comprehensive markdown report

You must return a valid JSON object matching this exact schema:
{
  "verdict": "SAFE_TO_MERGE" | "REQUIRES_CHANGES" | "NEEDS_DISCUSSION",
  "summary": "Executive summary (2-3 sentences)",
  "criticalIssues": ["Issue 1 description", "Issue 2 description"],
  "suggestions": ["Suggestion 1", "Suggestion 2"],
  "markdownReport": "Full markdown report with headers, bullet points, code blocks, and emojis"
}

Verdict Rules:
- SAFE_TO_MERGE: No critical/high severity issues from any agent
- REQUIRES_CHANGES: At least one critical or high severity issue exists
- NEEDS_DISCUSSION: Complex trade-offs that need human judgment

For the markdownReport field, create a comprehensive review that includes:
- ✨ Executive Summary
- 🛡️ Security Analysis (from SecurityAgent findings)
- 🏗️ Architecture Analysis (from ArchitectureAgent findings)
- 🚨 Critical Issues (prioritized)
- 💡 Suggestions
- ✅ Final Verdict with reasoning

Return ONLY the JSON object. No markdown wrapping around the JSON itself.`;

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
