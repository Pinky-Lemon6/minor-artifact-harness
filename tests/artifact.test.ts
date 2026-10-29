import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yazl from "yazl";
import { readZip, writeZip } from "../src/util/zip.ts";
import { openArtifactTool, readManifestTool } from "../src/tools/artifact.ts";
import { ensureFixtures } from "../fixtures/make-fixtures.ts";
import { createRunContext } from "../src/harness/context.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { MockModel } from "../src/models/mock.ts";
import { baseInputs } from "./helpers.ts";
import type { RunContext } from "../src/harness/types.ts";

async function makeSymlinkZip(path: string, target: string): Promise<Uint8Array> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(target), path, { mode: 0o120777 });
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

async function baseCtx(): Promise<RunContext> {
  ensureFixtures();
  const runDir = await mkdtemp(join(tmpdir(), "mah-artifact-"));
  const registry = new ToolRegistry();
  registry.register(openArtifactTool);
  registry.register(readManifestTool);
  const ctx = await createRunContext({
    runId: "artifact",
    runDir,
    inputs: baseInputs(),
    config: structuredClone(defaultConfig),
    model: new MockModel([]),
    registry,
  });
  ctx.activeToolNames.add("artifact.open");
  ctx.activeToolNames.add("artifact.manifest");
  return ctx;
}

test("readZip rejects path traversal and absolute paths", async () => {
  const zip = writeZip({ "../evil.txt": new TextEncoder().encode("x") });
  await assert.rejects(() => readZip(zip, { maxEntries: 10, maxUncompressedBytes: 1000 }), /path traversal/i);
  const absolute = writeZip({ "/etc/passwd": new TextEncoder().encode("x") });
  await assert.rejects(() => readZip(absolute, { maxEntries: 10, maxUncompressedBytes: 1000 }), /absolute path/i);
});

test("readZip rejects symlink entries", async () => {
  const zip = await makeSymlinkZip("link", "/etc/passwd");
  await assert.rejects(() => readZip(zip, { maxEntries: 10, maxUncompressedBytes: 1000 }), /symlink/i);
});

test("readZip enforces entry and size limits", async () => {
  const tooMany = writeZip({
    "a.txt": new Uint8Array([1]),
    "b.txt": new Uint8Array([1]),
    "c.txt": new Uint8Array([1]),
  });
  await assert.rejects(() => readZip(tooMany, { maxEntries: 2, maxUncompressedBytes: 1000 }), /too many entries/i);
  const tooLarge = writeZip({ "a.txt": new Uint8Array(2000) });
  await assert.rejects(() => readZip(tooLarge, { maxEntries: 10, maxUncompressedBytes: 1000 }), /too large/i);
});

test("artifact.open extracts the good fixture and records its hash", async () => {
  const ctx = await baseCtx();
  const result = await openArtifactTool.execute({ source: "fixture", fixture: "good" }, ctx);
  assert.equal(result.ok, true);
  assert.equal(ctx.artifact?.sha256.length, 64);
  assert.ok(existsSync(join(ctx.workspace!, "manifest.json")));
});
