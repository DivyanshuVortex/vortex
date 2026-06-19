/**
 * AgentTool — Interface for tools that agents can use to verify their analysis.
 *
 * Tools allow agents to go beyond static diff analysis and actually
 * inspect the codebase, run commands, and verify assumptions.
 */
export interface AgentTool {
  /** Unique tool name (used in JSON tool calls) */
  name: string;
  /** Human-readable description (injected into the agent prompt) */
  description: string;
  /** Executes the tool with the given arguments and returns a string result */
  execute(args: Record<string, string>): Promise<string>;
}

/**
 * ToolRegistry — Central registry for all available agent tools.
 *
 * Usage:
 * ```ts
 * const registry = new ToolRegistry();
 * registry.register(new GrepTool());
 * registry.register(new TypeCheckTool());
 * const tools = registry.getAll();
 * agent.registerTools(tools);
 * ```
 */
export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  /**
   * Registers a tool. Overwrites any existing tool with the same name.
   */
  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Gets a tool by name.
   */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns all registered tools as an array.
   */
  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns the number of registered tools.
   */
  get count(): number {
    return this.tools.size;
  }
}
