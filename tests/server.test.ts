import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server/server.ts";
import { defaultConfig } from "../src/config/schema.ts";
import { ensureFixtures } from "../fixtures/make-fixtures.ts";

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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
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

test("GET / serves the form", async () => {
  const { baseUrl, close } = await startTestServer();
  const html = await (await fetch(baseUrl)).text();
  assert.match(html, /id="inspect-form"/);
  assert.match(html, /id="trace-panel"/);
  await close();
});

test("POST /api/inspect accepts an uploaded artifact in agent mode", async () => {
  ensureFixtures();
  const { baseUrl, close } = await startTestServer();
  try {
    const zip = readFileSync(join(process.cwd(), "fixtures/build/good.zip")).toString("base64");
    const response = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactBase64: zip,
        artifactFilename: "good.zip",
        declaredVersion: "1.5.0",
        previousVersion: "1.4.2",
        mode: "agent",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "pass");
    assert.equal(body.report.artifact.filename, "good.zip");
  } finally {
    await close();
  }
});

test("per-run overrides are whitelisted, validated, and not persisted", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const invalidReport = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fixture: "good",
        declaredVersion: "1.5.0",
        previousVersion: "1.4.2",
        overrides: { report: { template: "/etc/hostname" } },
      }),
    });
    assert.equal(invalidReport.status, 400);

    const invalidBumps = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fixture: "good",
        declaredVersion: "1.5.0",
        previousVersion: "1.4.2",
        overrides: { checks: { allowedBumps: "minor" } },
      }),
    });
    assert.equal(invalidBumps.status, 400);

    const valid = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fixture: "good",
        declaredVersion: "1.5.0",
        previousVersion: "1.4.2",
        overrides: { harness: { maxSteps: 2 } },
      }),
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).status, "warn");

    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(config.config.harness.maxSteps, 16);
  } finally {
    await close();
  }
});

test("an unreadable upload is a run-level error, and missing previous version is a check failure", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const badZip = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactBase64: Buffer.from("not a zip").toString("base64"),
        artifactFilename: "broken.zip",
        declaredVersion: "1.5.0",
        previousVersion: "1.4.2",
      }),
    });
    assert.equal(badZip.status, 200);
    assert.equal((await badZip.json()).status, "error");

    const badZipFixed = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactBase64: Buffer.from("not a zip").toString("base64"),
        artifactFilename: "broken.zip",
        declaredVersion: "1.5.0",
        previousVersion: "1.4.2",
        mode: "fixed",
      }),
    });
    assert.equal(badZipFixed.status, 200);
    assert.equal((await badZipFixed.json()).status, "error");

    const noPrevious = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture: "good", declaredVersion: "1.5.0" }),
    });
    assert.equal(noPrevious.status, 200);
    assert.equal((await noPrevious.json()).status, "fail");
  } finally {
    await close();
  }
});

test("static file traversal is rejected", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/..%2F..%2Fetc/passwd`);
    assert.ok([400, 404].includes(response.status), `unexpected status ${response.status}`);
  } finally {
    await close();
  }
});

test("preload selection runs the preloaded plan without skill.load", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fixture: "good",
        declaredVersion: "1.5.0",
        previousVersion: "1.4.2",
        skillSelection: "preload",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "pass");
    const trace = await (await fetch(`${baseUrl}/api/runs/${body.runId}/trace`)).text();
    assert.doesNotMatch(trace, /"tool":"skill\.load"/);
  } finally {
    await close();
  }
});
