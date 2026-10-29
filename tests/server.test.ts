import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server/server.ts";
import { defaultConfig } from "../src/config/schema.ts";

async function startTestServer() {
  const runsDir = await mkdtemp(join(tmpdir(), "mah-server-"));
  const config = structuredClone(defaultConfig);
  config.report.outputDir = runsDir;
  config.model.mock.planFile = join(process.cwd(), "fixtures/plans/agent-full-check.json");
  const server = createServer({ config, cwd: process.cwd() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("POST /api/inspect runs a fixture and returns a report", async () => {
  const { baseUrl, close } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixture: "good", declaredVersion: "1.5.0", previousVersion: "1.4.2", mode: "agent" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "pass");
  assert.equal(body.report.checks.length, 5);
  assert.equal((await (await fetch(`${baseUrl}/api/runs`)).json()).runs.length, 1);
  await close();
});

test("invalid run ids and traversal are rejected", async () => {
  const { baseUrl, close } = await startTestServer();
  assert.equal((await fetch(`${baseUrl}/api/runs/..%2F..%2Fetc`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/runs/nope`)).status, 404);
  await close();
});
