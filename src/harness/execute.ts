import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureFixtures } from "../../fixtures/make-fixtures.ts";
import { validatePolicy } from "../config/policy.ts";
import type { HarnessConfig } from "../config/schema.ts";
import { MockModel, loadMockPlan } from "../models/mock.ts";
import { createRegistry } from "../tools/index.ts";
import { createRunContext } from "./context.ts";
import { runFixed } from "./flow.ts";
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
  const config = structuredClone(opts.config);
  config.flow.mode = opts.inputs.mode;
  const { inputs } = opts;

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

  let effectiveInputs = inputs;
  if (inputs.artifactSource === "upload" && inputs.uploadPath) {
    const stored = join(runDir, "artifact.zip");
    copyFileSync(inputs.uploadPath, stored);
    effectiveInputs = { ...inputs, uploadPath: stored };
  }

  const registry = createRegistry();
  if (effectiveInputs.artifactSource === "fixture") ensureFixtures(cwd);
  validatePolicy(config, new Set(registry.listNames()));

  const model =
    effectiveInputs.mode === "fixed"
      ? new MockModel([])
      : new MockModel(loadMockPlan(resolve(cwd, config.model.mock.planFile), effectiveInputs));

  const ctx = await createRunContext({
    runId,
    runDir,
    inputs: effectiveInputs,
    config,
    model,
    registry,
  });
  const result =
    effectiveInputs.mode === "fixed" ? await runFixed(ctx) : await runAgent(ctx);

  if (effectiveInputs.artifactSource === "upload" && !config.runs.retainArtifacts) {
    rmSync(join(runDir, "artifact.zip"), { force: true });
  }

  return result;
}
