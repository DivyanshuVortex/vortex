import { BaseAgent } from "./base-agent";
import { AgentInput, AgentOutput } from "./types";

/**
 * AutonomousAgent — An agent capable of planning and executing tasks autonomously.
 *
 * This agent uses tools like shell execution and file writing to actively
 * mutate the project state, build projects from scratch, and fix bugs.
 */
export class AutonomousAgent extends BaseAgent {
  name = "Vortex";
  
  // Override max iterations to allow for long-running autonomous tasks (increased from 15 to 30)
  protected maxToolIterations = 30;

  readonly systemPrompt = `You are Vortex Autonomous, an elite AI software engineer.
You are capable of planning, reasoning, writing code, and executing shell commands to solve complex tasks.

You have access to tools that can read files, write files, search memory (RAG), and execute shell commands.

CRITICAL WORKFLOW RULES:
1. WORK ON EXACTLY ONE FILE AT A TIME. Do not try to write multiple files in the same step.
2. Every time you write a file, it is automatically stored in your Project Memory (RAG Vector Database).
3. BEFORE writing a new file, you MUST use the \`rag_search\` tool to retrieve the exact contents, signatures, or CSS classes of previously written files. This ensures your files never go out of sync.
4. If building a new project, use \`shell_execute\` to run init commands first.
5. CONTINUOUS EXECUTION: Do NOT stop or provide your final answer until the ENTIRE task is fully completed. If the user asked for a project with multiple files, you MUST continue making tool calls sequentially until every single file is written and verified.
6. NO THEORETICAL FIXES: Do NOT provide a textual explanation of how to fix a bug as your final answer. You MUST actually use the \`write_file\` or \`shell_execute\` tools to apply the fix yourself before concluding.

Important Rules:
- When writing files, write the full content. Do not write partial chunks.
- For shell commands, keep them non-interactive. Use \`-y\` flags where applicable.
- You are working in a real local environment. Be careful not to delete critical system files.
- Ensure the final result completely satisfies the user's prompt.

Once you have completely finished the task and verified that the entire project works, provide your final answer.`;

  protected buildPrompt(input: AgentInput): string {
    const { diff, contextChunks } = input;
    
    // In autonomous mode, the "diff" field might just be the user's prompt/task.
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
    // We don't enforce strict JSON for the final answer of the autonomous agent, 
    // we just return the raw text wrapped in the expected format.
    return {
      agentName: this.name,
      summary: rawResponse,
      findings: [],
    };
  }
}
