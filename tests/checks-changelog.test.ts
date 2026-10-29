import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkChangelog } from "../src/tools/checks.ts";
import { checkCtx } from "./check-ctx.ts";

test("version heading passes, including CRLF", async () => {
  const ctx = await checkCtx("good");
  await writeFile(join(ctx.workspace!, "CHANGELOG.md"), "## [1.5.0]\r\n- fixed\r\n");
  assert.equal((await checkChangelog(ctx)).status, "pass");
});

test("missing version heading fails", async () => {
  const ctx = await checkCtx("good");
  await writeFile(join(ctx.workspace!, "CHANGELOG.md"), "## [1.4.0]\r\n");
  assert.equal((await checkChangelog(ctx)).status, "fail");
});
