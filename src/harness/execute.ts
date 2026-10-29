import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessConfig } from "../config/schema.ts";
import { MockModel, loadMockPlan } from "../models/mock.ts";
import { demoEchoTool } from "../tools/demo.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { createRunContext } from "./context.ts";
import { runAgent } from "./loop.ts";
import type { RunInputs, RunResult } from "./types.ts";

function makeRunId(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}-${randomBytes(3).toString("hex")}`;
}

export async function executeRun(opts: {
  inputs: RunInputs;
  config: HarnessConfig;
  cwd?: string;
}): Promise<RunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const { inputs, config } = opts;

  if (!inputs.declaredVersion) throw new Error("declaredVersion is required");
  if (!inputs.previousVersion) throw new Error("previousVersion is required");
  if (inputs.artifactSource === "fixture" && !inputs.fixture) throw new Error("fixture is required");
  if (inputs.artifactSource === "upload" && !inputs.uploadPath) throw new Error("uploadPath is required");
  if (config.model.adapter !== "mock") {
    throw new Error(`model adapter not implemented: ${config.model.adapter}`);
  }

  const runId = makeRunId();
  const runDir = resolve(cwd, config.report.outputDir, runId);
  mkdirSync(runDir, { recursive: true });

  const model = new MockModel(loadMockPlan(resolve(cwd, config.model.mock.planFile), inputs));
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);

  const ctx = await createRunContext({ runId, runDir, inputs, config, model, registry });
  return runAgent(ctx);
}
