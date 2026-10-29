import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFixed } from "../src/harness/flow.ts";
import { validatePolicy } from "../src/config/policy.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { executeRun } from "../src/harness/execute.ts";
import { createRegistry } from "../src/tools/index.ts";
import { baseInputs } from "./helpers.ts";

async function runFixture(fixture: string, mode: "agent" | "fixed") {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-full-check.json";
  config.report.outputDir = await mkdtemp(join(tmpdir(), "mah-flow-"));
  config.flow.mode = mode;
  return executeRun({ inputs: baseInputs({ fixture, mode }), config });
}

test("fixed flow runs stages in order and writes the same verdict as agent mode", async () => {
  const fixed = await runFixture("good", "fixed");
  const agent = await runFixture("good", "agent");
  assert.equal(fixed.report.status, "pass");
  assert.deepEqual(
    fixed.report.checks.map((c) => [c.id, c.status]),
    agent.report.checks.map((c) => [c.id, c.status]),
  );
});

test("fixed flow rejects an unknown stage or a stage outside the allowlist", () => {
  assert.throws(
    () =>
      validatePolicy(
        { ...defaultConfig, flow: { mode: "fixed", stages: [{ tool: "nope" }] } },
        new Set(["artifact.open"]),
      ),
    /unknown tool/i,
  );
  assert.throws(
    () =>
      validatePolicy(
        {
          ...defaultConfig,
          harness: { ...defaultConfig.harness, toolAllowlist: ["artifact.open"] },
        },
        new Set(createRegistry().listNames()),
      ),
    /allowlist/i,
  );
});

test("runFixed is exported", () => {
  assert.equal(typeof runFixed, "function");
});

test("fixed flow rejects a stage list that omits a required tool", () => {
  assert.throws(
    () =>
      validatePolicy(
        {
          ...defaultConfig,
          flow: {
            mode: "fixed",
            stages: [
              { tool: "artifact.open" },
              { tool: "artifact.manifest" },
              { tool: "checks.version" },
            ],
          },
        },
        new Set(createRegistry().listNames()),
      ),
    /missing required tool/i,
  );
});
