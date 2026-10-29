import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { mergeConfig, type ConfigOverride, type HarnessConfig } from "../config/schema.ts";
import { executeRun } from "../harness/execute.ts";
import type { RunInputs } from "../harness/types.ts";
import { loadSkillCatalog } from "../skills/loader.ts";
import { createRegistry } from "../tools/index.ts";
import { assertRunId, listRuns, readRun } from "./runStore.ts";

const MAX_BODY_BYTES = 12 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res: ServerResponse, status: number, text: string, type: string): void {
  res.writeHead(status, { "content-type": type });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function runsDir(ctx: { config: HarnessConfig; cwd: string }): string {
  return resolve(ctx.cwd, ctx.config.report.outputDir);
}

async function inspect(req: IncomingMessage, res: ServerResponse, ctx: { config: HarnessConfig; cwd: string }): Promise<void> {
  const payload = await readJson(req);
  const declaredVersion = typeof payload.declaredVersion === "string" ? payload.declaredVersion : "";
  const previousVersion = typeof payload.previousVersion === "string" ? payload.previousVersion : "";
  if (!declaredVersion || !previousVersion) {
    throw new HttpError(400, "declaredVersion and previousVersion are required");
  }

  const fixture = typeof payload.fixture === "string" ? payload.fixture : undefined;
  const artifactBase64 = typeof payload.artifactBase64 === "string" ? payload.artifactBase64 : undefined;
  if (!fixture && !artifactBase64) {
    throw new HttpError(400, "fixture or artifactBase64 is required");
  }

  let uploadPath: string | undefined;
  if (artifactBase64) {
    uploadPath = join(tmpdir(), `mah-upload-${randomBytes(6).toString("hex")}.zip`);
    writeFileSync(uploadPath, Buffer.from(artifactBase64, "base64"));
  }

  const overrides =
    payload.overrides && typeof payload.overrides === "object"
      ? (payload.overrides as ConfigOverride)
      : {};
  const config = mergeConfig(ctx.config, overrides);
  const inputs: RunInputs = {
    artifactSource: uploadPath ? "upload" : "fixture",
    fixture,
    uploadPath,
    artifactFilename:
      typeof payload.artifactFilename === "string"
        ? payload.artifactFilename
        : fixture
          ? `${fixture}.zip`
          : "artifact.zip",
    declaredVersion,
    previousVersion,
    mode: payload.mode === "fixed" ? "fixed" : "agent",
    skillSelection: payload.skillSelection === "preload" ? "preload" : undefined,
  };

  try {
    const result = await executeRun({ inputs, config, cwd: ctx.cwd });
    sendJson(res, 200, { runId: result.runId, status: result.status, report: result.report });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const inputError = /required|invalid|unknown tool|allowlist|skill (misses|not found)/i.test(message);
    throw new HttpError(inputError ? 400 : 500, message);
  } finally {
    if (uploadPath) rmSync(uploadPath, { force: true });
  }
}

function runRoute(path: string, res: ServerResponse, ctx: { config: HarnessConfig; cwd: string }): void {
  const parts = path.split("/").filter(Boolean);
  let runId: string;
  try {
    runId = decodeURIComponent(parts[2] ?? "");
  } catch {
    throw new HttpError(400, "invalid run id");
  }

  try {
    assertRunId(runId);
  } catch {
    throw new HttpError(400, "invalid run id");
  }

  let run;
  try {
    run = readRun(runsDir(ctx), runId);
  } catch (error) {
    if (error instanceof Error && /invalid run id/.test(error.message)) {
      throw new HttpError(400, error.message);
    }
    throw new HttpError(404, `run not found: ${runId}`);
  }

  if (parts.length === 3) {
    sendJson(res, 200, run);
    return;
  }
  if (parts.length === 4 && parts[3] === "trace") {
    sendJson(res, 200, { trace: run.trace });
    return;
  }
  if (parts.length === 4 && parts[3] === "report.json") {
    sendText(res, 200, JSON.stringify(run.report, null, 2), MIME[".json"]);
    return;
  }
  if (parts.length === 4 && parts[3] === "report.md") {
    const pathToReport = join(runsDir(ctx), runId, "report.md");
    if (!existsSync(pathToReport)) throw new HttpError(404, "report.md not found");
    sendText(res, 200, readFileSync(pathToReport, "utf8"), MIME[".md"]);
    return;
  }

  throw new HttpError(404, "not found");
}

function staticFile(path: string, res: ServerResponse, ctx: { cwd: string }): void {
  const webRoot = resolve(ctx.cwd, "web");
  const relative = path === "/" ? "index.html" : path.slice(1);
  const filePath = resolve(webRoot, relative);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`)) {
    throw new HttpError(400, "invalid static path");
  }
  if (!existsSync(filePath)) throw new HttpError(404, "not found");
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { config: HarnessConfig; cwd: string },
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && path === "/api/config") {
      const registry = createRegistry();
      sendJson(res, 200, {
        config: ctx.config,
        skills: loadSkillCatalog(ctx.config.harness.skillDirs),
        tools: registry.descriptors(new Set(registry.listNames())),
      });
      return;
    }
    if (req.method === "POST" && path === "/api/inspect") {
      await inspect(req, res, ctx);
      return;
    }
    if (req.method === "GET" && path === "/api/runs") {
      sendJson(res, 200, { runs: listRuns(runsDir(ctx)) });
      return;
    }
    if (req.method === "GET" && path.startsWith("/api/runs/")) {
      runRoute(path, res, ctx);
      return;
    }
    if (req.method === "GET") {
      staticFile(path, res, ctx);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) sendJson(res, status, { error: message });
    else res.end();
  }
}
