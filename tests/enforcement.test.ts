import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeRun } from "../src/harness/execute.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { baseInputs } from "./helpers.ts";

test("agent final before required checks is rejected and the loop continues", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-missing-required.json";
  config.report.outputDir = await mkdtemp(join(tmpdir(), "mah-enforce-"));
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  const trace = await readFile(join(result.runDir, "trace.jsonl"), "utf8");
  assert.match(trace, /missing required checks/);
  assert.equal(result.report.checks.length, 5);
  assert.equal(result.status, "pass");
});

test("maxSteps auto-runs missing required checks", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-open-only.json";
  config.harness.maxSteps = 2;
  config.report.outputDir = await mkdtemp(join(tmpdir(), "mah-enforce-"));
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  assert.equal(result.status, "warn");
  assert.equal(result.report.incomplete, true);
  assert.deepEqual(
    result.report.checks.map((c) => c.id).sort(),
    ["changelog", "forbidden", "integrity", "required_files", "version"],
  );
});

test("an early report.write is rebuilt from the final check results", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-early-report.json";
  config.report.outputDir = await mkdtemp(join(tmpdir(), "mah-enforce-"));
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  assert.equal(result.status, "pass");
  assert.equal(result.report.checks.length, 5);
  const persisted = JSON.parse(await readFile(join(result.runDir, "report.json"), "utf8")) as {
    checks: unknown[];
    status: string;
  };
  assert.equal(persisted.checks.length, 5);
  assert.equal(persisted.status, "pass");
});

test("a tool outside the active set is denied and the loop continues", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-denied-tool.json";
  config.report.outputDir = await mkdtemp(join(tmpdir(), "mah-enforce-"));
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  const trace = await readFile(join(result.runDir, "trace.jsonl"), "utf8");
  assert.match(trace, /tool_not_allowed/);
  assert.equal(result.status, "pass");
});

test("a run without report.write falls back and marks the report", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-open-only.json";
  config.harness.maxSteps = 2;
  config.report.outputDir = await mkdtemp(join(tmpdir(), "mah-enforce-"));
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  assert.equal(result.report.fallback, true);
});
