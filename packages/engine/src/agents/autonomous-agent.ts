import { BaseAgent } from "./base-agent";
import { AgentInput, AgentOutput } from "./types";
import { Prompts } from "@vortex/shared";

/**
 * AutonomousAgent — An agent capable of planning and executing tasks autonomously.
 *
 * This agent uses tools like shell execution and file writing to actively
 * mutate the project state, build projects from scratch, and fix bugs.
 * It operates via a State-Machine Orchestrator.
 */
export class AutonomousAgent extends BaseAgent {
  name = "Vortex";
  
  protected maxToolIterations = 30; // overridden by maxSteps if provided

  readonly systemPrompt = Prompts.autonomousSystemPrompt;

  protected buildPrompt(input: AgentInput): string {
    const { diff, contextChunks } = input;
    
    let prompt = `USER TASK:\n${diff}\n`;

    if (contextChunks && contextChunks.length > 0) {
      prompt += `\nPROVIDED CONTEXT:\n`;
      contextChunks.forEach((chunk, i) => {
        prompt += `--- Context Chunk ${i + 1} (${chunk.file}) ---\n${chunk.content}\n\n`;
      });
    }

    return prompt;
  }

  protected parseOutput(rawResponse: string): AgentOutput {
    return {
      agentName: this.name,
      summary: rawResponse,
      findings: [],
    };
  }
}
