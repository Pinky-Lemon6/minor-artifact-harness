import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessConfig } from "../config/schema.ts";
import { loadSkill } from "../skills/loader.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import { createTraceWriter } from "./trace.ts";
import type { LoadedSkill, ModelAdapter, RunContext, RunInputs } from "./types.ts";

export async function createRunContext(opts: {
  runId: string;
  runDir: string;
  inputs: RunInputs;
  config: HarnessConfig;
  model: ModelAdapter;
  registry: ToolRegistry;
}): Promise<RunContext> {
  mkdirSync(opts.runDir, { recursive: true });
  writeFileSync(join(opts.runDir, "config.json"), `${JSON.stringify(opts.config, null, 2)}\n`, "utf8");

  const activeToolNames = new Set<string>();
  const loadedSkills = new Map<string, LoadedSkill>();
  if (opts.inputs.mode === "fixed") {
    for (const stage of opts.config.flow.stages) activeToolNames.add(stage.tool);
  } else if (opts.config.harness.activeSkills.length === 0) {
    for (const name of opts.registry.listNames()) activeToolNames.add(name);
  } else {
    activeToolNames.add("skill.load");
    activeToolNames.add("skill.read");

    const selection = opts.inputs.skillSelection ?? opts.config.harness.skillSelection;
    if (selection === "preload") {
      const allowlist = opts.config.harness.toolAllowlist;
      for (const name of opts.config.harness.activeSkills) {
        const skill = loadSkill(name, opts.config.harness.skillDirs);
        loadedSkills.set(skill.name, skill);
        for (const tool of skill.tools) {
          if (allowlist.length === 0 || allowlist.includes(tool)) activeToolNames.add(tool);
        }
      }
    }
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
    loadedSkills,
    activeToolNames,
    model: opts.model,
    trace: createTraceWriter(opts.runDir),
    startedAt: Date.now(),
    reportWritten: false,
  };
}
