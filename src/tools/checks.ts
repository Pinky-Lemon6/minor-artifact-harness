import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { minimatch } from "minimatch";
import { diff, gt, valid } from "semver";
import { z } from "zod";
import type { CheckStatus } from "../config/schema.ts";
import type { CheckResult, RunContext, ToolDefinition, ToolResult } from "../harness/types.ts";
import { sha256 } from "../util/hash.ts";
import { resolveInside } from "../util/path.ts";

type SubCheck = { status: CheckStatus; detail: string };

const SEVERITY: Record<CheckStatus, number> = { skip: 0, pass: 1, warn: 2, fail: 3 };

function worstStatus(checks: SubCheck[]): CheckStatus {
  return checks.reduce<CheckStatus>(
    (worst, check) => (SEVERITY[check.status] > SEVERITY[worst] ? check.status : worst),
    "skip",
  );
}

function failedNames(evidence: Record<string, SubCheck>): string[] {
  return Object.entries(evidence)
    .filter(([, check]) => check.status === "fail")
    .map(([name]) => name);
}

export async function checkVersion(ctx: RunContext): Promise<CheckResult> {
  const declared = ctx.inputs.declaredVersion;
  const previous = ctx.inputs.previousVersion;
  const evidence: Record<string, SubCheck> = {};

  if (!declared) {
    return {
      id: "version",
      title: "版本一致性",
      status: "fail",
      required: true,
      summary: "version check failed: missing declared version",
      evidence: { declaredVersion: { status: "fail", detail: "declaredVersion is empty" } },
    };
  }

  const manifestVersion = ctx.manifest?.version;
  evidence.manifestVersion =
    manifestVersion === declared
      ? { status: "pass", detail: `manifest version ${manifestVersion}` }
      : {
          status: "fail",
          detail: `manifest version ${manifestVersion ?? "(missing)"} != declared ${declared}`,
        };

  const packagePath = ctx.workspace ? join(ctx.workspace, "package.json") : null;
  if (!packagePath || !existsSync(packagePath)) {
    evidence.packageVersion = { status: "skip", detail: "package.json not present" };
  } else {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
      evidence.packageVersion =
        pkg.version === declared
          ? { status: "pass", detail: `package.json version ${declared}` }
          : {
              status: "fail",
              detail: `package.json version ${String(pkg.version ?? "(missing)")} != declared ${declared}`,
            };
    } catch {
      evidence.packageVersion = { status: "fail", detail: "package.json is not valid JSON" };
    }
  }

  const filename = ctx.artifact?.filename ?? ctx.inputs.artifactFilename;
  const filenameMatch = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(filename);
  if (!ctx.config.checks.checkFilenameVersion) {
    evidence.filenameVersion = { status: "skip", detail: "filename version check disabled" };
  } else if (!filenameMatch) {
    evidence.filenameVersion = { status: "skip", detail: `no version in filename ${filename}` };
  } else {
    evidence.filenameVersion =
      filenameMatch[1] === declared
        ? { status: "pass", detail: `filename version ${filenameMatch[1]}` }
        : {
            status: "fail",
            detail: `filename version ${filenameMatch[1]} != declared ${declared}`,
          };
  }

  if (!previous) {
    evidence.bump = { status: "fail", detail: "previousVersion is empty" };
  } else if (!valid(previous)) {
    evidence.bump = { status: "fail", detail: `previousVersion is not valid semver: ${previous}` };
  } else if (!valid(declared)) {
    evidence.bump = { status: "fail", detail: `declaredVersion is not valid semver: ${declared}` };
  } else if (gt(previous, declared)) {
    evidence.bump = {
      status: "fail",
      detail: `version rollback: ${previous} -> ${declared} is older`,
    };
  } else {
    const change = diff(previous, declared);
    evidence.bump =
      change && ctx.config.checks.allowedBumps.includes(change as never)
        ? { status: "pass", detail: `${previous} -> ${declared} is ${change}` }
        : {
            status: "fail",
            detail: `${previous} -> ${declared} is ${change ?? "no change"}, allowed: ${ctx.config.checks.allowedBumps.join(", ")}`,
          };
  }

  const status = worstStatus(Object.values(evidence));
  const failed = failedNames(evidence);
  const summary =
    status === "fail"
      ? `version check failed: ${failed.join(", ")}`
      : `version check ${status}`;

  return { id: "version", title: "版本一致性", status, required: true, summary, evidence };
}

export const checkVersionTool: ToolDefinition<Record<string, never>> = {
  name: "checks.version",
  description: "Check version consistency across the declared version, manifest, package.json, filename, and previous version.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  execute: async (_args, ctx: RunContext): Promise<ToolResult> => {
    const result = await checkVersion(ctx);
    ctx.checkResults.set(result.id, result);
    return { ok: true, summary: result.summary, data: result };
  },
};

function workspaceMissing(): CheckResult {
  return {
    id: "required_files",
    title: "必填文件",
    status: "fail",
    required: true,
    summary: "artifact workspace is not open",
    evidence: { reason: "workspace missing" },
  };
}

export async function checkRequiredFiles(ctx: RunContext): Promise<CheckResult> {
  if (!ctx.workspace) {
    return { ...workspaceMissing(), id: "required_files", title: "必填文件" };
  }

  const present: string[] = [];
  const missing: string[] = [];
  const unsafe: string[] = [];
  for (const file of ctx.config.checks.requiredFiles) {
    try {
      const full = resolveInside(ctx.workspace, file);
      if (statSync(full).isFile()) present.push(file);
      else missing.push(file);
    } catch {
      missing.push(file);
      unsafe.push(file);
    }
  }

  const status: CheckStatus = missing.length ? "fail" : "pass";
  return {
    id: "required_files",
    title: "必填文件",
    status,
    required: true,
    summary:
      status === "fail"
        ? `required files missing: ${missing.join(", ")}`
        : `all ${present.length} required files present`,
    evidence: { present, missing, unsafe },
  };
}

export const checkRequiredFilesTool: ToolDefinition<Record<string, never>> = {
  name: "checks.required_files",
  description: "Check that every configured required file exists in the artifact.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  execute: async (_args, ctx: RunContext): Promise<ToolResult> => {
    const result = await checkRequiredFiles(ctx);
    ctx.checkResults.set(result.id, result);
    return { ok: true, summary: result.summary, data: result };
  },
};

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(root);
  return files.sort();
}

function isOsJunk(path: string): boolean {
  const base = path.split("/").pop();
  return base === ".DS_Store" || base === "Thumbs.db" || path.startsWith("__MACOSX/");
}

type IntegrityProblem = { path: string; field: string; expected: unknown; actual: unknown };

export async function checkIntegrity(ctx: RunContext): Promise<CheckResult> {
  if (!ctx.workspace) {
    return {
      id: "integrity",
      title: "完整性",
      status: "fail",
      required: true,
      summary: "artifact workspace is not open",
      evidence: { reason: "workspace missing" },
    };
  }
  if (!ctx.manifest) {
    return {
      id: "integrity",
      title: "完整性",
      status: "fail",
      required: true,
      summary: "manifest is not loaded",
      evidence: { reason: "manifest missing" },
    };
  }

  const actualFiles = walkFiles(ctx.workspace);
  const listed = new Set<string>();
  const missing: string[] = [];
  const duplicatePaths: string[] = [];
  const problems: IntegrityProblem[] = [];

  for (const file of ctx.manifest.files) {
    if (listed.has(file.path)) {
      duplicatePaths.push(file.path);
      continue;
    }
    listed.add(file.path);

    let full: string;
    try {
      full = resolveInside(ctx.workspace, file.path);
    } catch {
      problems.push({
        path: file.path,
        field: "path",
        expected: "safe relative path",
        actual: file.path,
      });
      continue;
    }

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      missing.push(file.path);
      continue;
    }
    if (!stat.isFile()) {
      problems.push({ path: file.path, field: "type", expected: "file", actual: "not a file" });
      continue;
    }
    if (stat.size > 10 * 1024 * 1024) {
      problems.push({ path: file.path, field: "size", expected: "<= 10 MB", actual: stat.size });
      continue;
    }
    if (stat.size !== file.size) {
      problems.push({ path: file.path, field: "size", expected: file.size, actual: stat.size });
    }
    const actualHash = sha256(readFileSync(full));
    if (actualHash !== file.sha256) {
      problems.push({ path: file.path, field: "sha256", expected: file.sha256, actual: actualHash });
    }
  }

  const extra = actualFiles.filter(
    (path) => !listed.has(path) && path !== "manifest.json" && !isOsJunk(path),
  );
  const extraFails = extra.length > 0 && !ctx.config.checks.allowExtraFiles;

  const parts: string[] = [];
  if (missing.length) parts.push(`missing files: ${missing.join(", ")}`);
  if (duplicatePaths.length) parts.push(`duplicate manifest paths: ${duplicatePaths.join(", ")}`);
  if (problems.length) {
    parts.push(
      ...problems.map(
        (problem) => `${problem.field} mismatch for ${problem.path}`,
      ),
    );
  }
  if (extra.length) parts.push(`extra files: ${extra.join(", ")}`);

  let status: CheckStatus = "pass";
  if (missing.length || duplicatePaths.length || problems.length || extraFails) status = "fail";
  else if (extra.length) status = "warn";

  return {
    id: "integrity",
    title: "完整性",
    status,
    required: true,
    summary: status === "pass" ? "all manifest files match" : `integrity ${status}: ${parts.join("; ")}`,
    evidence: {
      checked: ctx.manifest.files.length,
      missing,
      duplicatePaths,
      problems,
      extra,
      allowExtraFiles: ctx.config.checks.allowExtraFiles,
    },
  };
}

export const checkIntegrityTool: ToolDefinition<Record<string, never>> = {
  name: "checks.integrity",
  description: "Check file existence, sizes, SHA-256 hashes, and extra files against manifest.json.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  execute: async (_args, ctx: RunContext): Promise<ToolResult> => {
    const result = await checkIntegrity(ctx);
    ctx.checkResults.set(result.id, result);
    return { ok: true, summary: result.summary, data: result };
  },
};

const CONTENT_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "private_key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/ },
];

export async function checkForbidden(ctx: RunContext): Promise<CheckResult> {
  if (!ctx.workspace) {
    return {
      id: "forbidden",
      title: "禁用文件",
      status: "fail",
      required: true,
      summary: "artifact workspace is not open",
      evidence: { reason: "workspace missing" },
    };
  }

  const files = walkFiles(ctx.workspace);
  const pathHits: { path: string; pattern: string }[] = [];
  for (const file of files) {
    for (const pattern of ctx.config.checks.forbiddenPatterns) {
      if (minimatch(file, pattern, { dot: true, matchBase: true })) {
        pathHits.push({ path: file, pattern });
      }
    }
  }

  const contentHits: { path: string; pattern: string }[] = [];
  if (ctx.config.checks.scanContent) {
    for (const file of files) {
      const full = join(ctx.workspace, file);
      if (statSync(full).size > 1024 * 1024) continue;
      const text = readFileSync(full, "utf8");
      for (const { name, regex } of CONTENT_PATTERNS) {
        if (regex.test(text)) contentHits.push({ path: file, pattern: name });
      }
    }
  }

  const contentStatus: CheckStatus = contentHits.length
    ? ctx.config.checks.contentScanSeverity
    : "pass";
  const status = worstStatus([
    { status: pathHits.length ? "fail" : "pass", detail: "path patterns" },
    { status: contentStatus, detail: "content patterns" },
  ]);

  const parts: string[] = [];
  if (pathHits.length) {
    parts.push(`forbidden files: ${[...new Set(pathHits.map((hit) => hit.path))].join(", ")}`);
  }
  if (contentHits.length) {
    parts.push(
      `content scan hits: ${[...new Set(contentHits.map((hit) => hit.path))].join(", ")}`,
    );
  }

  return {
    id: "forbidden",
    title: "禁用文件",
    status,
    required: true,
    summary: parts.length ? `forbidden ${status}: ${parts.join("; ")}` : "no forbidden files or content hits",
    evidence: {
      pathHits,
      contentHits,
      patterns: ctx.config.checks.forbiddenPatterns,
      scanContent: ctx.config.checks.scanContent,
      contentScanSeverity: ctx.config.checks.contentScanSeverity,
    },
  };
}

export const checkForbiddenTool: ToolDefinition<Record<string, never>> = {
  name: "checks.forbidden",
  description: "Check forbidden file patterns and optionally scan text content for private keys and cloud access keys.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  execute: async (_args, ctx: RunContext): Promise<ToolResult> => {
    const result = await checkForbidden(ctx);
    ctx.checkResults.set(result.id, result);
    return { ok: true, summary: result.summary, data: result };
  },
};

export async function checkChangelog(ctx: RunContext): Promise<CheckResult> {
  const version = ctx.inputs.declaredVersion;
  if (!ctx.workspace) {
    return {
      id: "changelog",
      title: "变更记录",
      status: "fail",
      required: true,
      summary: "artifact workspace is not open",
      evidence: { reason: "workspace missing" },
    };
  }

  const file = ctx.config.checks.changelogFile;
  let full: string;
  try {
    full = resolveInside(ctx.workspace, file);
  } catch {
    return {
      id: "changelog",
      title: "变更记录",
      status: "fail",
      required: true,
      summary: `invalid changelog path: ${file}`,
      evidence: { file, version, reason: "unsafe path" },
    };
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    return {
      id: "changelog",
      title: "变更记录",
      status: "fail",
      required: true,
      summary: `changelog not found: ${file}`,
      evidence: { file, version, reason: "missing" },
    };
  }

  const lines = readFileSync(full, "utf8").split(/\r?\n/);
  const headings = lines.filter((line) => line.startsWith("#"));
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionRe = new RegExp(`(^|[^0-9A-Za-z.-])${escaped}(?![0-9A-Za-z.-])`);
  const heading = headings.find((line) => versionRe.test(line));

  return {
    id: "changelog",
    title: "变更记录",
    status: heading ? "pass" : "fail",
    required: true,
    summary: heading
      ? `changelog contains ${version}`
      : `changelog has no heading for ${version}`,
    evidence: { file, version, heading, headings: headings.slice(0, 20) },
  };
}

export const checkChangelogTool: ToolDefinition<Record<string, never>> = {
  name: "checks.changelog",
  description: "Check that the changelog contains a heading for the declared version.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  execute: async (_args, ctx: RunContext): Promise<ToolResult> => {
    const result = await checkChangelog(ctx);
    ctx.checkResults.set(result.id, result);
    return { ok: true, summary: result.summary, data: result };
  },
};
