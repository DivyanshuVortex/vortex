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
  protected maxToolIterations = 3;

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
  public async run(
    input: AgentInput,
    options?: { 
      onToolCall?: (toolName: string, args: Record<string, string>) => void;
      onToolResult?: (toolName: string, result: string) => void;
    }
  ): Promise<AgentOutput> {
    const prompt = this.buildPrompt(input);
    let fullPrompt = `${this.systemPrompt}\n\n${prompt}`;

    // If tools are registered, add tool descriptions and enter ReAct loop
    if (this.tools.length > 0) {
      fullPrompt += this.buildToolSection();
      const rawOutput = await this.reactLoop(fullPrompt, options);
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
  private async reactLoop(
    prompt: string,
    options?: { 
      onToolCall?: (toolName: string, args: Record<string, string>) => void;
      onToolResult?: (toolName: string, result: string) => void;
    }
  ): Promise<string> {
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
      if (options?.onToolCall) {
        options.onToolCall(toolCall.name, toolCall.args);
      }
      
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

      if (options?.onToolResult) {
        options.onToolResult(toolCall.name, toolResult);
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
    // 1. Try to extract from a markdown code block
    const jsonBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    let cleaned = (jsonBlockMatch && jsonBlockMatch[1]) ? jsonBlockMatch[1] : response;

    // 2. Wrap in array and parse if multiple objects exist (e.g. {}{})
    // This handles the case where the LLM outputs multiple tool calls separated by whitespace/newlines
    const arrayWrapped = `[${cleaned.replace(/\}\s*\{/g, '},{')}]`;
    try {
      const parsedArray = JSON.parse(arrayWrapped);
      if (Array.isArray(parsedArray)) {
        for (const item of parsedArray) {
          if (item && item.tool_call && item.tool_call.name) {
            return {
              name: item.tool_call.name,
              args: item.tool_call.args || {},
            };
          }
        }
      }
    } catch {
      // Fallthrough
    }

    // 3. Try to find any single JSON object containing "tool_call"
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        if (parsed && parsed.tool_call && parsed.tool_call.name) {
          return {
            name: parsed.tool_call.name,
            args: parsed.tool_call.args || {},
          };
        }
      } catch {
        // Fallthrough
      }
    }

    // 4. Fallback regex if it's malformed but close
    const toolCallMatch = response.match(
      /\{"tool_call"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*\}\s*\}/
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

IMPORTANT: You may only call ONE tool per response. Do not output multiple tool calls at once.

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
    retries = 3
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
