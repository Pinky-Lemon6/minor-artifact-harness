import { z } from "zod";
import type { ToolDefinition } from "../harness/types.ts";

export const demoEchoTool: ToolDefinition<{ text: string }> = {
  name: "demo.echo",
  description: "Echo the provided text. Used by the harness demo.",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "Text to echo" } },
    required: ["text"],
  },
  schema: z.object({ text: z.string() }),
  execute: async (args) => ({ ok: true, summary: args.text, data: args }),
};
