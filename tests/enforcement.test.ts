import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { executeRun } from "../src/harness/execute.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { baseInputs } from "./helpers.ts";

test("agent final before required checks is rejected and the loop continues", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-missing-required.json";
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
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  assert.equal(result.status, "warn");
  assert.equal(result.report.incomplete, true);
  assert.deepEqual(
    result.report.checks.map((c) => c.id).sort(),
    ["changelog", "forbidden", "integrity", "required_files", "version"],
  );
});
