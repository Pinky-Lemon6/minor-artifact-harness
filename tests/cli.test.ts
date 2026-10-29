import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("cli demo exits 0 and prints the final answer", () => {
  const result = spawnSync(process.execPath, ["src/cli.ts", "demo"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /done/);
});
