import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, mergeConfig, validateConfig } from "../src/config/schema.ts";
import { loadConfig } from "../src/config/load.ts";

test("default config validates", () => {
  assert.deepEqual(validateConfig(defaultConfig), defaultConfig);
});

test("arrays replace instead of merging", () => {
  const merged = mergeConfig(defaultConfig, { checks: { requiredFiles: ["only.txt"] } });
  assert.deepEqual(merged.checks.requiredFiles, ["only.txt"]);
  assert.equal(merged.checks.scanContent, defaultConfig.checks.scanContent);
});

test("invalid maxSteps reports its path", () => {
  assert.throws(
    () => validateConfig({ ...defaultConfig, harness: { ...defaultConfig.harness, maxSteps: 0 } }),
    /harness\.maxSteps/,
  );
});

test("local.yaml overrides default.yaml", async () => {
  const root = await mkdtemp(join(tmpdir(), "mah-config-"));
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config/default.yaml"), "harness:\n  maxSteps: 16\n");
  await writeFile(join(root, "config/local.yaml"), "harness:\n  maxSteps: 4\n");
  assert.equal(loadConfig({ cwd: root }).harness.maxSteps, 4);
});
