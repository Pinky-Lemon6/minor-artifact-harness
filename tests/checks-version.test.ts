import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkVersion } from "../src/tools/checks.ts";
import { ensureFixtures } from "../fixtures/make-fixtures.ts";
import { createRunContext } from "../src/harness/context.ts";
import { createRegistry } from "../src/tools/index.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { MockModel } from "../src/models/mock.ts";
import { openArtifactTool, readManifestTool } from "../src/tools/artifact.ts";
import { baseInputs } from "./helpers.ts";
import type { RunContext } from "../src/harness/types.ts";

async function ctxFor(
  fixture: string,
  opts: { declared: string; previous: string; filename?: string; keepManifestVersion?: boolean },
): Promise<RunContext> {
  ensureFixtures();
  const runDir = await mkdtemp(join(tmpdir(), "mah-check-"));
  const ctx = await createRunContext({
    runId: fixture,
    runDir,
    inputs: baseInputs({
      fixture,
      artifactFilename: opts.filename ?? `demo-app-${opts.declared}.zip`,
      declaredVersion: opts.declared,
      previousVersion: opts.previous,
    }),
    config: structuredClone(defaultConfig),
    model: new MockModel([]),
    registry: createRegistry(),
  });
  ctx.activeToolNames.add("artifact.open");
  ctx.activeToolNames.add("artifact.manifest");
  assert.equal((await openArtifactTool.execute({ source: "fixture", fixture }, ctx)).ok, true);
  assert.equal((await readManifestTool.execute({}, ctx)).ok, true);

  if (!opts.keepManifestVersion) {
    const manifestPath = join(ctx.workspace!, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
    manifest.version = opts.declared;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    ctx.manifest = { ...ctx.manifest!, version: opts.declared };

    const packagePath = join(ctx.workspace!, "package.json");
    if (existsSync(packagePath)) {
      const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { version: string };
      pkg.version = opts.declared;
      await writeFile(packagePath, JSON.stringify(pkg, null, 2));
    }
  }
  return ctx;
}

test("matching versions pass", async () => {
  const result = await checkVersion(await ctxFor("good", { declared: "1.5.0", previous: "1.4.2" }));
  assert.equal(result.status, "pass");
});

test("manifest mismatch fails", async () => {
  const result = await checkVersion(
    await ctxFor("bad-version", { declared: "1.5.0", previous: "1.4.2", keepManifestVersion: true }),
  );
  assert.equal(result.status, "fail");
  assert.match(result.summary, /manifest/i);
});

test("major bump fails; patch and minor pass", async () => {
  assert.equal((await checkVersion(await ctxFor("good", { declared: "2.0.0", previous: "1.4.2" }))).status, "fail");
  assert.equal((await checkVersion(await ctxFor("good", { declared: "1.4.3", previous: "1.4.2" }))).status, "pass");
  assert.equal((await checkVersion(await ctxFor("good", { declared: "1.6.0", previous: "1.4.2" }))).status, "pass");
});

test("missing previous version fails; unparsable filename is a skip", async () => {
  assert.equal((await checkVersion(await ctxFor("good", { declared: "1.5.0", previous: "" }))).status, "fail");
  const result = await checkVersion(
    await ctxFor("good", { declared: "1.5.0", previous: "1.4.2", filename: "artifact.zip" }),
  );
  assert.equal((result.evidence.filenameVersion as { status: string }).status, "skip");
});
