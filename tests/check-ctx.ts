import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureFixtures } from "../fixtures/make-fixtures.ts";
import { createRunContext } from "../src/harness/context.ts";
import { createRegistry } from "../src/tools/index.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { MockModel } from "../src/models/mock.ts";
import { openArtifactTool, readManifestTool } from "../src/tools/artifact.ts";
import { baseInputs } from "./helpers.ts";
import type { RunContext } from "../src/harness/types.ts";

export async function checkCtx(fixture: string): Promise<RunContext> {
  ensureFixtures();
  const runDir = await mkdtemp(join(tmpdir(), "mah-check-"));
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
  const opened = await openArtifactTool.execute({ source: "fixture", fixture }, ctx);
  if (!opened.ok) throw new Error(opened.summary);
  const manifest = await readManifestTool.execute({}, ctx);
  if (!manifest.ok) throw new Error(manifest.summary);
  return ctx;
}
