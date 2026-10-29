import { test } from "node:test";
import assert from "node:assert/strict";
import { HARNESS_NAME } from "../src/version.ts";

test("harness name is stable", () => {
  assert.equal(HARNESS_NAME, "minor-artifact-harness");
});
