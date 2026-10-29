import type { RunContext, ToolDefinition, ToolDescriptor, ToolResult } from "../harness/types.ts";

const TOOL_TIMEOUT_MS = 5000;

class ToolTimeoutError extends Error {
  constructor(name: string) {
    super(`tool ${name} timed out after ${TOOL_TIMEOUT_MS}ms`);
    this.name = "ToolTimeoutError";
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }

  descriptors(allowed: Set<string>): ToolDescriptor[] {
    return [...this.tools.values()]
      .filter((tool) => allowed.has(tool.name))
      .map(({ name, description, parameters }) => ({ name, description, parameters }));
  }

  async execute(name: string, args: unknown, ctx: RunContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, summary: `unknown tool: ${name}`, error: { code: "unknown_tool", message: name } };
    }
    if (!ctx.activeToolNames.has(name)) {
      return {
        ok: false,
        summary: `tool not allowed: ${name}`,
        error: { code: "tool_not_allowed", message: name },
      };
    }

    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      return {
        ok: false,
        summary: `invalid arguments for ${name}`,
        error: { code: "invalid_args", message: JSON.stringify(parsed.error.issues) },
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolTimeoutError(name)), TOOL_TIMEOUT_MS);
      });
      return await Promise.race([tool.execute(parsed.data, ctx), timeout]);
    } catch (error) {
      if (error instanceof ToolTimeoutError) {
        return { ok: false, summary: error.message, error: { code: "timeout", message: error.message } };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, summary: `tool ${name} failed: ${message}`, error: { code: "tool_error", message } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
