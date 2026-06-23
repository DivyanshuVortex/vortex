import { GoogleGenAI } from "@google/genai";
import { AgentInput, AgentOutput, AgentState } from "./types";
import { AgentTool } from "../tools/tool-types";
import { generateWithRetry as sharedGenerateWithRetry } from "../llm";
import { Prompts } from "@vortex/shared";

/**
 * BaseAgent — Abstract foundation for all Vortex agents.
 *
 * Provides:
 * - Gemini API interaction with exponential backoff retry
 * - Structured output parsing (JSON extraction from LLM responses)
 * - State-Machine Orchestration loop (formerly ReAct loop)
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

  /** Maximum tool-calling iterations as an ultimate fallback */
  protected maxToolIterations = 30;

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
   * Runs the agent with optional State-Machine tool calling loop.
   */
  public async run(
    input: AgentInput,
    options?: {
      onToolCall?: (toolName: string, args: Record<string, string>) => void;
      onToolResult?: (toolName: string, result: string) => void;
      initialState?: AgentState;
      maxSteps?: number;
      verifyCommand?: string | boolean;
    }
  ): Promise<AgentOutput> {
    const prompt = this.buildPrompt(input);
    let fullPrompt = `${this.systemPrompt}\n\n${prompt}`;

    if (options?.maxSteps !== undefined) {
      this.maxToolIterations = options.maxSteps;
    }

    if (this.tools.length > 0) {
      fullPrompt += this.buildToolSection();
      const rawOutput = await this.reactLoop(fullPrompt, options);
      return this.parseOutput(rawOutput);
    }

    const rawOutput = await this.generateWithRetry(fullPrompt);
    return this.parseOutput(rawOutput);
  }

  protected abstract buildPrompt(input: AgentInput): string;
  protected abstract parseOutput(rawResponse: string): AgentOutput;

  /**
   * State-Machine Orchestration Loop.
   *
   * 1. Inject current AgentState into prompt
   * 2. Send prompt to LLM
   * 3. Parse <state_update> and <tool_calls> from LLM
   * 4. Merge state and execute tools
   * 5. Orchestrator independently evaluates success/failure and updates state
   * 6. Enforce invariants (e.g. stop after 3 failures)
   */
  private async reactLoop(
    prompt: string,
    options?: {
      onToolCall?: (toolName: string, args: Record<string, string>) => void;
      onToolResult?: (toolName: string, result: string) => void;
      initialState?: AgentState;
      verifyCommand?: string | boolean;
    }
  ): Promise<string> {
    let currentPrompt = prompt;
    let iterations = 0;

    const state: AgentState = options?.initialState || {
      evidence: { filesRead: [], symbolsObserved: [], dependenciesObserved: [], externalSchemasFound: {}, confidence: 'LOW' },
      plan: { steps: [], currentStepIndex: 0, completedSteps: [] },
      execution: { filesModified: [], commandsRun: [], lastError: null, consecutiveFailures: 0 },
      verification: { contractItems: [], passed: [], failed: [] },
      verdict: 'IN_PROGRESS'
    };

    while (iterations < this.maxToolIterations) {
      // Orchestrator Intervention moved below state merge
      const promptWithState = `${currentPrompt}\n\nCURRENT AGENT STATE:\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n\nPlease output your <state_update> and <tool_calls>. If you are completely finished, output FINAL_ANSWER in your response.`;

      let response = await this.generateWithRetry(promptWithState);

      console.log(`\n[Agent Debug] Raw LLM Response (Iter ${iterations}):\n${response}\n--------------------\n`);

      const hallucinationIndex = response.search(/\[(?:Tool Response|System)/);
      if (hallucinationIndex !== -1) {
        response = response.substring(0, hallucinationIndex).trim();
      }

      // Parse and merge <state_update>
      const stateUpdateMatch = response.match(/<state_update>([\s\S]*?)<\/state_update>/i);
      if (stateUpdateMatch && stateUpdateMatch[1]) {
        this.mergeStateUpdate(state, stateUpdateMatch[1]);
      }

      // Orchestrator Verification Intervention
      if (state.verdict === 'COMPLETE') {
        if (options?.verifyCommand) {
          const cmd = typeof options.verifyCommand === 'string' ? options.verifyCommand : 'npm run build';
          currentPrompt += `\n\n[System - Orchestrator Intervention] You marked the task as COMPLETE. Running verification command: \`${cmd}\`...`;
          let verifySuccess = false;
          let verifyOutput = "";
          try {
            const { execSync } = require('child_process');
            const env = { ...process.env };
            delete env.NODE_ENV;
            verifyOutput = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env });
            verifySuccess = true;
          } catch (e: any) {
            verifyOutput = (e.stdout ? e.stdout.toString() : '') + '\n' + (e.stderr ? e.stderr.toString() : e.message);
          }
          if (verifySuccess) {
            if (response.includes("FINAL_ANSWER")) return response;
            currentPrompt += `\nVerification succeeded.\nOutput:\n${verifyOutput}\n\nTask is verified as complete.`;
            break;
          } else {
            state.verdict = 'IN_PROGRESS';
            currentPrompt += `\nVerification FAILED. You must fix these errors before the task can be marked as complete.\nOutput:\n${verifyOutput}`;
            iterations++;
            continue;
          }
        } else {
          if (response.includes("FINAL_ANSWER")) return response;
          currentPrompt += `\n\n[System] Orchestrator determined verdict is ${state.verdict}. Providing final response.`;
          break;
        }
      } else if (state.verdict === 'INCOMPLETE') {
        if (response.includes("FINAL_ANSWER")) return response;
        currentPrompt += `\n\n[System] Orchestrator determined verdict is ${state.verdict}. Providing final response.`;
        break;
      }

      // Enforce Confidence Gate explicitly
      if (state.evidence.confidence === 'LOW' && state.plan.steps.length > 0) {
        currentPrompt += `\n\n[System - Orchestrator Intervention] You attempted to progress to planning but your confidence is LOW. You must gather more evidence before proceeding.`;
        state.plan.steps = []; // wipe hallucinated plan
        iterations++;
        continue;
      }

      const toolCalls = this.extractToolCalls(response);

      if (!toolCalls || toolCalls.length === 0) {
        if (response.includes("FINAL_ANSWER")) {
          return response;
        }

        if (!response.trim()) {
          currentPrompt += `\n\n[System] Your response was completely empty. You must emit <state_update> and <tool_calls> or provide FINAL_ANSWER.`;
          iterations++;
          continue;
        }

        if (response.includes("<think>") && !response.toLowerCase().includes("final") && !response.toLowerCase().includes("answer")) {
          currentPrompt += `\n\n${response}\n\n[System] You provided a thought block but no tool calls and no FINAL_ANSWER.`;
          iterations++;
          continue;
        }

        currentPrompt += `\n\n[System] You did not call a tool and did not state FINAL_ANSWER. You must either call tools or explicitely write "FINAL_ANSWER" to complete the task.`;
        iterations++;
        continue;
      }

      let toolResultsPrompts = "";
      let hasError = false;
      let lastErrorMessage = "";

      for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        if (!toolCall) continue;

        if (options?.onToolCall) {
          options.onToolCall(toolCall.name, toolCall.args);
        }

        const tool = this.tools.find((t) => t.name === toolCall.name);
        if (!tool) {
          toolResultsPrompts += `\n\n[${i + 1}] ${toolCall.name}(...) →\n<result>Error: Tool "${toolCall.name}" not found.</result>`;
          hasError = true;
          lastErrorMessage = `Tool "${toolCall.name}" not found.`;
          continue;
        }

        let toolResult: string;
        try {
          toolResult = await tool.execute(toolCall.args);
          if (toolResult.toLowerCase().includes("error") || toolResult.toLowerCase().includes("failed") || toolResult.toLowerCase().includes("command failed")) {
            hasError = true;
            lastErrorMessage = toolResult;
          }
        } catch (err) {
          toolResult = `Error executing tool: ${err}`;
          hasError = true;
          lastErrorMessage = String(err);
        }

        if (options?.onToolResult) {
          options.onToolResult(toolCall.name, toolResult);
        }

        toolResultsPrompts += `\n\n[${i + 1}] ${toolCall.name} →\n<result>\n${toolResult}\n</result>`;
      }

      // Orchestrator Failure Tracking
      if (hasError) {
        state.execution.consecutiveFailures += 1;
        state.execution.lastError = lastErrorMessage;
        if (state.execution.consecutiveFailures >= 3) {
          state.verdict = 'INCOMPLETE';
          currentPrompt += `\n\nOBSERVATIONS (${toolCalls.length} results):${toolResultsPrompts}\n\n[System - Orchestrator Intervention] You have failed 3 consecutive times with the same or similar errors. The task is blocked. Verdict set to INCOMPLETE. Provide your FINAL_ANSWER.`;
          iterations++;
          continue; // The next loop iteration will break because verdict is INCOMPLETE
        }
      } else {
        state.execution.consecutiveFailures = 0;
        state.execution.lastError = null;
      }

      currentPrompt += `\n\nOBSERVATIONS (${toolCalls.length} results):${toolResultsPrompts}`;
      iterations++;
    }

    currentPrompt += "\n\n[System] Maximum iterations or Orchestrator constraint reached. Please provide your FINAL_ANSWER now.";
    return this.generateWithRetry(currentPrompt);
  }

  private mergeStateUpdate(state: AgentState, xml: string) {
    const evidenceAddedMatches = xml.match(/<evidence_added>([\s\S]*?)<\/evidence_added>/ig);
    if (evidenceAddedMatches) {
      for (const block of evidenceAddedMatches) {
        const fileMatch = block.match(/<file>(.*?)<\/file>/i);
        if (fileMatch && fileMatch[1] && !state.evidence.filesRead.includes(fileMatch[1].trim())) {
          state.evidence.filesRead.push(fileMatch[1].trim());
        }
        const symMatch = block.match(/<symbol>(.*?)<\/symbol>/i);
        if (symMatch && symMatch[1] && !state.evidence.symbolsObserved.includes(symMatch[1].trim())) {
          state.evidence.symbolsObserved.push(symMatch[1].trim());
        }
        const depMatch = block.match(/<dependency>(.*?)<\/dependency>/i);
        if (depMatch && depMatch[1] && !state.evidence.dependenciesObserved.includes(depMatch[1].trim())) {
          state.evidence.dependenciesObserved.push(depMatch[1].trim());
        }
      }
    }

    const confidenceMatch = xml.match(/<confidence>(LOW|MEDIUM|HIGH)<\/confidence>/i);
    if (confidenceMatch && confidenceMatch[1]) {
      state.evidence.confidence = confidenceMatch[1].toUpperCase() as any;
    }

    const stepCompletedMatch = xml.match(/<step_completed>(.*?)<\/step_completed>/i);
    if (stepCompletedMatch && stepCompletedMatch[1]) {
      if (!state.plan.completedSteps.includes(stepCompletedMatch[1].trim())) {
        state.plan.completedSteps.push(stepCompletedMatch[1].trim());
        state.plan.currentStepIndex++;
      }
    }

    const verdictMatch = xml.match(/<verdict>(IN_PROGRESS|COMPLETE|INCOMPLETE)<\/verdict>/i);
    if (verdictMatch && verdictMatch[1]) {
      state.verdict = verdictMatch[1].toUpperCase() as any;
    }
  }

  private extractToolCalls(
    response: string
  ): { name: string; args: Record<string, string>; isXml?: boolean; prefix?: string }[] {
    const cleanResponse = response.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<state_update>[\s\S]*?<\/state_update>/ig, '').trim();
    const calls: { name: string; args: Record<string, string>; isXml?: boolean; prefix?: string }[] = [];

    const xmlRegex = /<([a-zA-Z0-9_]+_)?tool_call>([\s\S]*?)<\/\1tool_call>/g;
    let xmlMatch;
    while ((xmlMatch = xmlRegex.exec(cleanResponse)) !== null) {
      const prefix = xmlMatch[1] || "";
      const blockContent = xmlMatch[2] || "";
      
      let name = "";
      const nameMatch = blockContent.match(/^\s*([a-zA-Z0-9_]+)/);
      const tagMatch = blockContent.match(/<([a-zA-Z0-9_]*_)?(tool_)?name>\s*([a-zA-Z0-9_]+)\s*<\/\1\2name>/);
      
      if (tagMatch && tagMatch[3]) {
         name = tagMatch[3].trim();
      } else if (nameMatch && nameMatch[1]) {
         name = nameMatch[1].trim();
      }

      const args: Record<string, string> = {};
      const argRegex = new RegExp(`<(${prefix})?arg_key>\\s*([^<]+)\\s*<\\/\\1?arg_key>\\s*<(${prefix})?arg_value>\\s*([\\s\\S]*?)\\s*<\\/\\3?arg_value>`, "g");
      let match;
      while ((match = argRegex.exec(blockContent)) !== null) {
        if (match[2] && match[4]) {
          args[match[2].trim()] = match[4].trim();
        }
      }

      const directTagRegex = /<([a-zA-Z0-9_]+)>\s*([\s\S]*?)\s*<\/\1>/g;
      let directMatch;
      while ((directMatch = directTagRegex.exec(blockContent)) !== null) {
        if (directMatch[1] && directMatch[2]) {
          const key = directMatch[1].trim();
          if (key !== 'tool_call' && key !== 'tool_name' && key !== 'name' && key !== 'arg_key' && key !== 'arg_value') {
            args[key] = directMatch[2].trim();
          }
        }
      }

      if (name) {
        calls.push({ name, args, isXml: true, prefix });
      }
    }

    if (calls.length > 0) return calls;

    const jsonBlockMatch = cleanResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    let cleaned = (jsonBlockMatch && jsonBlockMatch[1]) ? jsonBlockMatch[1] : cleanResponse;

    let toParse = cleaned.trim();
    if (toParse.startsWith('{') && toParse.endsWith('}') && toParse.includes('}{')) {
      toParse = `[${toParse.replace(/\}\s*\{/g, '},{')}]`;
    }
    
    try {
      const parsedObj = JSON.parse(toParse);
      const items = Array.isArray(parsedObj) ? parsedObj : [parsedObj];
      for (const item of items) {
        if (item && item.tool_call && item.tool_call.name) {
          calls.push({
            name: item.tool_call.name,
            args: item.tool_call.args || {},
          });
        }
      }
    } catch { }

    if (calls.length > 0) return calls;

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
              try { finalArgs = JSON.parse(extractedArgs); } catch (e) { }
            }
            calls.push({
              name: extractedName,
              args: finalArgs,
            });
          }
        }
      } catch { }
    }

    if (calls.length > 0) return calls;

    const toolCallMatch = response.match(
      /\{"tool_call"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*\}\s*\}/
    );

    const fallbackParser = () => {
      if (cleaned.includes('"write_file"')) {
        const pathMatch = cleaned.match(/"path"\s*:\s*"([^"]+)"/);
        // Use a less greedy match or one that stops before the next tool call
        const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*?)"\s*\}\s*\}[\s,\[\]]*(?:\{"tool_call"|$)/);
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
          calls.push({
            name: "write_file",
            args: { path: pathMatch[1], content: parsedContent } as Record<string, string>
          });
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
          calls.push({
            name: "shell_execute",
            args: { command: parsedCmd } as Record<string, string>
          });
        }
      }
      return calls;
    };

    if (!toolCallMatch) return fallbackParser();

    try {
      const parsed = JSON.parse(toolCallMatch[0]);
      calls.push({
        name: parsed.tool_call.name,
        args: parsed.tool_call.args || {},
      });
      return calls;
    } catch {
      return fallbackParser();
    }
  }

  private buildToolSection(): string {
    if (this.tools.length === 0) return "";

    const toolDescriptions = this.tools
      .map((tool) => `- **${tool.name}**: ${tool.description}`)
      .join("\n");

    return "\n\n## Available Tools\n" + Prompts.baseAgentTools(toolDescriptions);
  }

  protected async generateWithRetry(
    prompt: string,
    retries = 3
  ): Promise<string> {
    return sharedGenerateWithRetry(this.client, prompt, {
      retries,
      label: this.name,
    });
  }

  protected extractJSON<T>(response: string): T | null {
    try {
      return JSON.parse(response) as T;
    } catch {
      let cleaned = response;
      const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
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
