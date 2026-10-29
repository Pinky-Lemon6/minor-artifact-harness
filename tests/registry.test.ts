import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ToolRegistry } from "../src/tools/registry.ts";
import { createTraceWriter } from "../src/harness/trace.ts";
import type { RunContext, ToolDefinition } from "../src/harness/types.ts";

const echo: ToolDefinition<{ text: string }> = {
  name: "demo.echo",
  description: "Echo text",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  schema: z.object({ text: z.string() }),
  execute: async (args) => ({ ok: true, summary: args.text, data: args }),
};

function ctxWith(registry: ToolRegistry, allowed: string[]): RunContext {
  return { registry, activeToolNames: new Set(allowed) } as unknown as RunContext;
}

test("registers and executes an allowed tool", async () => {
  const registry = new ToolRegistry();
  registry.register(echo);
  const result = await registry.execute("demo.echo", { text: "hi" }, ctxWith(registry, ["demo.echo"]));
  assert.equal(result.ok, true);
  assert.equal(result.summary, "hi");
});

test("rejects unknown and unauthorized tools", async () => {
  const registry = new ToolRegistry();
  registry.register(echo);
  const unknown = await registry.execute("nope", {}, ctxWith(registry, ["demo.echo"]));
  const denied = await registry.execute("demo.echo", { text: "x" }, ctxWith(registry, []));
  assert.equal(unknown.error?.code, "unknown_tool");
  assert.equal(denied.error?.code, "tool_not_allowed");
});

test("invalid args and thrown errors become structured results", async () => {
  const registry = new ToolRegistry();
  registry.register(echo);
  const invalid = await registry.execute("demo.echo", {}, ctxWith(registry, ["demo.echo"]));
  assert.equal(invalid.error?.code, "invalid_args");
  const boom: ToolDefinition = {
    ...echo,
    name: "boom",
    execute: async () => {
      throw new Error("kaboom");
    },
  };
  registry.register(boom);
  const failed = await registry.execute("boom", { text: "x" }, ctxWith(registry, ["boom"]));
  assert.equal(failed.error?.code, "tool_error");
  assert.match(failed.error!.message, /kaboom/);
});

test("trace writes one JSON object per line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mah-trace-"));
  const trace = createTraceWriter(dir);
  trace.write({ step: 1, type: "tool_call", tool: "demo.echo" });
  trace.close();
  const lines = (await readFile(join(dir, "trace.jsonl"), "utf8")).trim().split("\n");
  assert.equal(JSON.parse(lines[0]).tool, "demo.echo");
});
