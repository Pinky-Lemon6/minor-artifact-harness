import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkRequiredFiles, checkIntegrity } from "../src/tools/checks.ts";
import { ensureFixtures } from "../fixtures/make-fixtures.ts";
import { createRunContext } from "../src/harness/context.ts";
import { createRegistry } from "../src/tools/index.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { MockModel } from "../src/models/mock.ts";
import { openArtifactTool, readManifestTool } from "../src/tools/artifact.ts";
import { baseInputs } from "./helpers.ts";
import type { RunContext } from "../src/harness/types.ts";

async function ctxFor(fixture: string): Promise<RunContext> {
  ensureFixtures();
  const runDir = await mkdtemp(join(tmpdir(), "mah-files-"));
  const ctx = await createRunContext({
    runId: fixture,
    runDir,
    inputs: baseInputs({ fixture }),
    config: structuredClone(defaultConfig),
    model: new MockModel([]),
    registry: createRegistry(),
  });
  ctx.activeToolNames.add("artifact.open");
  ctx.activeToolNames.add("artifact.manifest");
  assert.equal((await openArtifactTool.execute({ source: "fixture", fixture }, ctx)).ok, true);
  assert.equal((await readManifestTool.execute({}, ctx)).ok, true);
  return ctx;
}

test("missing required file fails", async () => {
  const result = await checkRequiredFiles(await ctxFor("missing-file"));
  assert.equal(result.status, "fail");
  assert.match(result.summary, /LICENSE/);
});

test("bad hash fails integrity", async () => {
  const result = await checkIntegrity(await ctxFor("bad-hash"));
  assert.equal(result.status, "fail");
  assert.match(result.summary, /sha256/i);
});

test("manifest.json, directories, and OS junk are exempt from extra files", async () => {
  const ctx = await ctxFor("good");
  await writeFile(join(ctx.workspace!, ".DS_Store"), "");
  const result = await checkIntegrity(ctx);
  assert.equal(result.status, "pass");
});

test("an unlisted payload file fails integrity", async () => {
  const ctx = await ctxFor("good");
  await writeFile(join(ctx.workspace!, "extra.txt"), "x");
  const result = await checkIntegrity(ctx);
  assert.equal(result.status, "fail");
  assert.match(result.summary, /extra/i);
});

test("manifest paths cannot escape the workspace", async () => {
  const ctx = await ctxFor("good");
  const manifestPath = join(ctx.workspace!, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    files: { path: string; sha256: string; size: number }[];
  };
  manifest.files.push({ path: "../outside.txt", sha256: "0".repeat(64), size: 0 });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  ctx.manifest = { ...ctx.manifest!, files: manifest.files };
  const result = await checkIntegrity(ctx);
  assert.equal(result.status, "fail");
  assert.match(result.summary, /path/i);
});

test("a directory does not satisfy a required file", async () => {
  const ctx = await ctxFor("good");
  await mkdir(join(ctx.workspace!, "required-dir"));
  ctx.config.checks.requiredFiles = ["required-dir"];
  const result = await checkRequiredFiles(ctx);
  assert.equal(result.status, "fail");
});
