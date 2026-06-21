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


    if (this.tools.length > 0) {
      fullPrompt += this.buildToolSection();
      const rawOutput = await this.reactLoop(fullPrompt, options);
      return this.parseOutput(rawOutput);
    }


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
      let response = await this.generateWithRetry(currentPrompt);


      const hallucinationIndex = response.search(/\[(?:Tool Response|System)/);
      if (hallucinationIndex !== -1) {
        response = response.substring(0, hallucinationIndex).trim();
      }


      const toolCall = this.extractToolCall(response);

      if (!toolCall) {
        if (hallucinationIndex !== -1) {
          currentPrompt += `\n\n[System] You attempted to hallucinate a Tool Response. You must output the actual JSON tool call to use a tool. Please provide a valid JSON tool call or provide your FINAL_ANSWER.`;
          iterations++;
          continue;
        }


        if (response.includes("<think>") && !response.toLowerCase().includes("final") && !response.toLowerCase().includes("answer")) {
          currentPrompt += `\n\n${response}\n\n[System] You provided a thought block but no valid JSON tool call. If you need to use a tool, output exactly the JSON format requested. If you are finished, please state your FINAL_ANSWER.`;
          iterations++;
          continue;
        }


        return response;
      }


      if (options?.onToolCall) {
        options.onToolCall(toolCall.name, toolCall.args);
      }
      
      const tool = this.tools.find((t) => t.name === toolCall.name);
      if (!tool) {
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


      currentPrompt += `\n\n[Tool Response from ${toolCall.name}]\n${toolResult}\n\nBased on this tool result, continue your analysis. You may call another tool or provide your FINAL_ANSWER.`;
      iterations++;
    }


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
    const cleanResponse = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();


    const jsonBlockMatch = cleanResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    let cleaned = (jsonBlockMatch && jsonBlockMatch[1]) ? jsonBlockMatch[1] : cleanResponse;


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


    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        if (parsed) {
          const extractedName = parsed.tool_call?.name || parsed.name || parsed.function?.name;
          const extractedArgs = parsed.tool_call?.args || parsed.parameters || parsed.arguments || parsed.function?.arguments || {};
          
          if (extractedName && extractedName !== "FINAL_ANSWER") {
            let finalArgs = extractedArgs;
            if (typeof extractedArgs === "string") {
              try { finalArgs = JSON.parse(extractedArgs); } catch (e) {}
            }
            return {
              name: extractedName,
              args: finalArgs,
            };
          }
        }
      } catch {
        // Fallthrough
      }
    }


    const toolCallMatch = response.match(
      /\{"tool_call"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*\}\s*\}/
    );

    const fallbackParser = () => {
      if (cleaned.includes('"write_file"')) {
        const pathMatch = cleaned.match(/"path"\s*:\s*"([^"]+)"/);
        const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*)"\s*\}\s*\}/);
        if (pathMatch && contentMatch && pathMatch[1] && contentMatch[1]) {
          let parsedContent = contentMatch[1];
          try {
            parsedContent = JSON.parse(`"${parsedContent}"`);
          } catch {
            parsedContent = parsedContent
              .replace(/\\"/g, '"')
              .replace(/\\n/g, '\n')
              .replace(/\\t/g, '\t')
              .replace(/\\r/g, '\r');
          }
          return {
            name: "write_file",
            args: {
              path: pathMatch[1],
              content: parsedContent
            } as Record<string, string>
          };
        }
      }
      
      if (cleaned.includes('"shell_execute"')) {
        const commandMatch = cleaned.match(/"command"\s*:\s*"([\s\S]*)"\s*\}\s*\}/);
        if (commandMatch && commandMatch[1]) {
          let parsedCmd = commandMatch[1];
          try {
            parsedCmd = JSON.parse(`"${parsedCmd}"`);
          } catch {
            parsedCmd = parsedCmd.replace(/\\"/g, '"');
          }
          return {
            name: "shell_execute",
            args: {
              command: parsedCmd
            } as Record<string, string>
          };
        }
      }
      return null;
    };

    if (!toolCallMatch) return fallbackParser();

    try {
      const parsed = JSON.parse(toolCallMatch[0]);
      return {
        name: parsed.tool_call.name,
        args: parsed.tool_call.args || {},
      };
    } catch {
      return fallbackParser();
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

      return JSON.parse(response) as T;
    } catch {

      let cleaned = response;
      const jsonBlockMatch = cleaned.match(
        /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/
      );
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        cleaned = jsonBlockMatch[1];
      }


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
