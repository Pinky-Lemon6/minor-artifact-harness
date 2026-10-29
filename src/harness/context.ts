import { mkdirSync } from "node:fs";
import type { HarnessConfig } from "../config/schema.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import { createTraceWriter } from "./trace.ts";
import type { ModelAdapter, RunContext, RunInputs } from "./types.ts";

export async function createRunContext(opts: {
  runId: string;
  runDir: string;
  inputs: RunInputs;
  config: HarnessConfig;
  model: ModelAdapter;
  registry: ToolRegistry;
}): Promise<RunContext> {
  mkdirSync(opts.runDir, { recursive: true });

  const activeToolNames = new Set<string>();
  if (opts.inputs.mode === "fixed") {
    for (const stage of opts.config.flow.stages) activeToolNames.add(stage.tool);
  } else if (opts.config.harness.activeSkills.length === 0) {
    for (const name of opts.registry.listNames()) activeToolNames.add(name);
  } else {
    activeToolNames.add("skill.load");
    activeToolNames.add("skill.read");
  }

  return {
    runId: opts.runId,
    runDir: opts.runDir,
    inputs: opts.inputs,
    config: opts.config,
    registry: opts.registry,
    workspace: null,
    artifact: null,
    manifest: null,
    checkResults: new Map(),
    loadedSkills: new Map(),
    activeToolNames,
    model: opts.model,
    trace: createTraceWriter(opts.runDir),
    startedAt: Date.now(),
    reportWritten: false,
  };
}
