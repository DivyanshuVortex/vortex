import { GoogleGenAI } from "@google/genai";
import { AgentInput, AgentOutput } from "./types";
import { AgentTool } from "../tools/tool-types";
import { generateWithRetry as sharedGenerateWithRetry } from "../llm";

/**
 * BaseAgent — Abstract foundation for all Vortex agents.
 *
 * Provides:
 * - Gemini API interaction with exponential backoff retry
 * - Structured output parsing (JSON extraction from LLM responses)
 * - ReAct-style tool-calling loop for self-verification
 *
 * Subclasses must implement:
 * - `name`: Agent identifier
 * - `systemPrompt`: Instructions for the LLM
 * - `buildPrompt(input)`: Constructs the full prompt from agent input
 * - `parseOutput(raw)`: Parses LLM response into structured output
 */
export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly systemPrompt: string;

  protected client: GoogleGenAI;
  protected tools: AgentTool[] = [];

  /** Maximum tool-calling iterations in the ReAct loop */
  private maxToolIterations = 3;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    this.client = new GoogleGenAI({ apiKey: key });
  }

  /**
   * Register tools for the agent to use during execution.
   */
  public registerTools(tools: AgentTool[]): void {
    this.tools = tools;
  }

  /**
   * Main execution entry point.
   * Runs the agent with optional ReAct-style tool calling.
   */
  public async run(input: AgentInput): Promise<AgentOutput> {
    const prompt = this.buildPrompt(input);
    let fullPrompt = `${this.systemPrompt}\n\n${prompt}`;

    // If tools are registered, add tool descriptions and enter ReAct loop
    if (this.tools.length > 0) {
      fullPrompt += this.buildToolSection();
      const rawOutput = await this.reactLoop(fullPrompt);
      return this.parseOutput(rawOutput);
    }

    // Simple mode: just prompt and parse
    const rawOutput = await this.generateWithRetry(fullPrompt);
    return this.parseOutput(rawOutput);
  }

  /**
   * Build the user prompt from the agent input.
   * Each specialized agent implements this differently.
   */
  protected abstract buildPrompt(input: AgentInput): string;

  /**
   * Parse the raw LLM response into a structured AgentOutput.
   * Each specialized agent implements this differently.
   */
  protected abstract parseOutput(rawResponse: string): AgentOutput;

  /**
   * ReAct-style tool-calling loop.
   *
   * 1. Send prompt to LLM with tool descriptions
   * 2. If LLM responds with TOOL_CALL JSON, execute the tool
   * 3. Append tool result to context and re-prompt
   * 4. Repeat until LLM gives FINAL_ANSWER or max iterations reached
   */
  private async reactLoop(prompt: string): Promise<string> {
    let currentPrompt = prompt;
    let iterations = 0;

    while (iterations < this.maxToolIterations) {
      const response = await this.generateWithRetry(currentPrompt);

      // Check if the response contains a tool call
      const toolCall = this.extractToolCall(response);

      if (!toolCall) {
        // No tool call — this is the final answer
        return response;
      }

      // Execute the tool
      const tool = this.tools.find((t) => t.name === toolCall.name);
      if (!tool) {
        // Tool not found — treat remaining response as final answer
        currentPrompt += `\n\n[System] Tool "${toolCall.name}" not found. Please provide your final answer without using tools.`;
        iterations++;
        continue;
      }

      let toolResult: string;
      try {
        toolResult = await tool.execute(toolCall.args);
      } catch (err) {
        toolResult = `Error executing tool: ${err}`;
      }

      // Append tool result to context and re-prompt
      currentPrompt += `\n\n[Tool Response from ${toolCall.name}]\n${toolResult}\n\nBased on this tool result, continue your analysis. You may call another tool or provide your FINAL_ANSWER.`;
      iterations++;
    }

    // Max iterations reached — get final answer
    currentPrompt +=
      "\n\n[System] Maximum tool iterations reached. Please provide your FINAL_ANSWER now.";
    return this.generateWithRetry(currentPrompt);
  }

  /**
   * Extracts a tool call from the LLM response if present.
   *
   * Expected format in the LLM response:
   * ```json
   * {"tool_call": {"name": "grep_search", "args": {"pattern": "cosine", "path": "."}}}
   * ```
   */
  private extractToolCall(
    response: string
  ): { name: string; args: Record<string, string> } | null {
    // Look for TOOL_CALL JSON blocks
    const toolCallMatch = response.match(
      /\{"tool_call"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"[^}]*\}\s*\}/
    );

    if (!toolCallMatch) return null;

    try {
      const parsed = JSON.parse(toolCallMatch[0]);
      return {
        name: parsed.tool_call.name,
        args: parsed.tool_call.args || {},
      };
    } catch {
      return null;
    }
  }

  /**
   * Builds the tool description section to inject into the prompt.
   */
  private buildToolSection(): string {
    if (this.tools.length === 0) return "";

    const toolDescriptions = this.tools
      .map(
        (tool) =>
          `- **${tool.name}**: ${tool.description}`
      )
      .join("\n");

    return `

## Available Tools
You have access to the following tools to verify your analysis. To use a tool, include EXACTLY this JSON in your response:
\`\`\`json
{"tool_call": {"name": "tool_name", "args": {"arg1": "value1"}}}
\`\`\`

${toolDescriptions}

When you are done analyzing (with or without tools), provide your final structured JSON output.
`;
  }

  /**
   * Calls the Gemini API with exponential backoff retry.
   * Delegates to the shared utility in llm.ts.
   */
  protected async generateWithRetry(
    prompt: string,
    retries = 5
  ): Promise<string> {
    return sharedGenerateWithRetry(this.client, prompt, {
      retries,
      label: this.name,
    });
  }

  /**
   * Extracts and parses a JSON object from the LLM response.
   * Handles markdown code fences and other formatting noise.
   */
  protected extractJSON<T>(response: string): T | null {
    try {
      // Try direct parse first
      return JSON.parse(response) as T;
    } catch {
      // Strip markdown code fences
      let cleaned = response;
      const jsonBlockMatch = cleaned.match(
        /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/
      );
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        cleaned = jsonBlockMatch[1];
      }

      // Try to find a JSON object in the text
      const objectMatch = cleaned.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]) as T;
        } catch {
          return null;
        }
      }

      return null;
    }
  }
}
