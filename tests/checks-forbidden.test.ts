import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkForbidden } from "../src/tools/checks.ts";
import { checkCtx } from "./check-ctx.ts";

test("dotfiles match forbidden patterns", async () => {
  const result = await checkForbidden(await checkCtx("forbidden"));
  assert.equal(result.status, "fail");
  assert.match(result.summary, /\.env/);
});

test("content-scan hits are warnings by default and can be raised to fail", async () => {
  const ctx = await checkCtx("good");
  await writeFile(join(ctx.workspace!, "notes.txt"), "-----BEGIN PRIVATE KEY-----\n");
  ctx.config.checks.scanContent = true;
  assert.equal((await checkForbidden(ctx)).status, "warn");
  ctx.config.checks.contentScanSeverity = "fail";
  assert.equal((await checkForbidden(ctx)).status, "fail");
});
