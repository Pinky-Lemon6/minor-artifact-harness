import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkillCatalog, loadSkill, parseSkillFile } from "../src/skills/loader.ts";
import { buildSystemPrompt } from "../src/harness/prompt.ts";
import { skillLoadTool, skillReadTool } from "../src/tools/skill.ts";
import { createRunContext } from "../src/harness/context.ts";
import { createRegistry } from "../src/tools/index.ts";
import { defaultConfig, type SkillSelection } from "../src/config/schema.ts";
import { MockModel } from "../src/models/mock.ts";
import { baseInputs } from "./helpers.ts";
import type { RunContext } from "../src/harness/types.ts";

async function skillCtx(opts: { selection: SkillSelection }): Promise<RunContext> {
  const runDir = await mkdtemp(join(tmpdir(), "mah-skill-"));
  const config = structuredClone(defaultConfig);
  config.harness.skillSelection = opts.selection;
  config.harness.activeSkills = ["minor-artifact-check"];
  return createRunContext({
    runId: "skill",
    runDir,
    inputs: baseInputs(),
    config,
    model: new MockModel([]),
    registry: createRegistry(),
  });
}

test("loads skill metadata and body", () => {
  const catalog = loadSkillCatalog(["skills"]);
  assert.equal(catalog[0].name, "minor-artifact-check");
  assert.ok(catalog[0].description.length > 0);
  assert.ok(loadSkill("minor-artifact-check", ["skills"]).body.includes("小版本制品检测流程"));
});

test("missing frontmatter or fields fail with a clear message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mah-skill-"));
  await writeFile(join(dir, "SKILL.md"), "---\ndescription: no name\n---\nbody");
  assert.throws(() => parseSkillFile(join(dir, "SKILL.md")), /name/);
});

test("auto mode prompt lists metadata but not the body; skill.load injects both", async () => {
  const ctx = await skillCtx({ selection: "auto" });
  assert.doesNotMatch(buildSystemPrompt(ctx), /小版本制品检测流程/);
  assert.match(buildSystemPrompt(ctx), /minor-artifact-check/);
  const loaded = await skillLoadTool.execute({ name: "minor-artifact-check" }, ctx);
  assert.equal(loaded.ok, true);
  assert.match(buildSystemPrompt(ctx), /小版本制品检测流程/);
});

test("skill.read blocks traversal outside the skill directory", async () => {
  const ctx = await skillCtx({ selection: "preload" });
  const result = await skillReadTool.execute(
    { name: "minor-artifact-check", path: "../../secret.txt" },
    ctx,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_traversal");
});
