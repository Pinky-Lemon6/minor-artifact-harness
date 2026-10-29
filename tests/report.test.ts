import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureReport } from "../src/tools/report.ts";
import {
  checkVersion,
  checkRequiredFiles,
  checkIntegrity,
  checkForbidden,
  checkChangelog,
} from "../src/tools/checks.ts";
import { checkCtx } from "./check-ctx.ts";
import type { RunContext } from "../src/harness/types.ts";

async function fullCtx(fixture: string): Promise<RunContext> {
  const ctx = await checkCtx(fixture);
  for (const check of [checkVersion, checkRequiredFiles, checkIntegrity, checkForbidden, checkChangelog]) {
    const result = await check(ctx);
    ctx.checkResults.set(result.id, result);
  }
  return ctx;
}

async function baseCtx(): Promise<RunContext> {
  return checkCtx("good");
}

test("writes report.json and report.md", async () => {
  const ctx = await fullCtx("good");
  const report = await ensureReport(ctx);
  assert.equal(report.status, "pass");
  assert.equal(JSON.parse(await readFile(join(ctx.runDir, "report.json"), "utf8")).status, "pass");
  assert.match(await readFile(join(ctx.runDir, "report.md"), "utf8"), /1\.5\.0/);
});

test("missing template falls back to the built-in markdown", async () => {
  const ctx = await fullCtx("good");
  ctx.config.report.template = "missing.md";
  await assert.doesNotReject(() => ensureReport(ctx));
});

test("missing required checks produce a warn, incomplete report", async () => {
  const ctx = await baseCtx();
  const report = await ensureReport(ctx);
  assert.equal(report.status, "warn");
  assert.equal(report.incomplete, true);
});
