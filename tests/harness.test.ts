import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../src/tools/registry.ts";
import { demoEchoTool } from "../src/tools/demo.ts";
import { MockModel, loadMockPlan } from "../src/models/mock.ts";
import { runAgent } from "../src/harness/loop.ts";
import { createRunContext } from "../src/harness/context.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { baseInputs } from "./helpers.ts";

test("mock model resolves placeholders and the loop records a full trace", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "mah-run-"));
  const planPath = join(runDir, "plan.json");
  await writeFile(planPath, JSON.stringify([
    { type: "tool_call", tool: "demo.echo", args: { text: "hello ${declaredVersion}" } },
    { type: "final", content: "done" },
  ]));
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  const config = structuredClone(defaultConfig);
  config.harness.maxSteps = 5;
  const model = new MockModel(loadMockPlan(planPath, baseInputs()));
  const ctx = await createRunContext({ runId: "r1", runDir, inputs: baseInputs(), config, model, registry });
  ctx.activeToolNames.add("demo.echo");
  const result = await runAgent(ctx);
  assert.equal(result.final, "done");
  assert.equal(result.report.checks.length, 0);
  assert.equal(result.report.incomplete, true);
  const trace = await readFile(join(runDir, "trace.jsonl"), "utf8");
  assert.match(trace, /hello 1\.5\.0/);
  assert.match(trace, /"type":"tool_call"/);
  assert.match(trace, /"type":"observation"/);
  assert.match(await readFile(join(runDir, "prompt.md"), "utf8"), /demo\.echo/);
});

test("maxSteps writes a warn, incomplete report", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "mah-run-"));
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  const config = structuredClone(defaultConfig);
  config.harness.maxSteps = 1;
  const model = new MockModel([
    { type: "tool_call", tool: "demo.echo", args: { text: "one" } },
    { type: "tool_call", tool: "demo.echo", args: { text: "two" } },
  ]);
  const ctx = await createRunContext({ runId: "r2", runDir, inputs: baseInputs(), config, model, registry });
  ctx.activeToolNames.add("demo.echo");
  const result = await runAgent(ctx);
  assert.equal(result.status, "warn");
  assert.equal(result.report.incomplete, true);
  assert.equal(result.report.reason, "max_steps");
});

test("plan exhaustion becomes an error report", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "mah-run-"));
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  const ctx = await createRunContext({
    runId: "r3",
    runDir,
    inputs: baseInputs(),
    config: structuredClone(defaultConfig),
    model: new MockModel([]),
    registry,
  });
  const result = await runAgent(ctx);
  assert.equal(result.status, "error");
  assert.equal(result.report.reason, "mock_plan_exhausted");
});
