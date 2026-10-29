import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { diff, valid } from "semver";
import { z } from "zod";
import type { CheckStatus } from "../config/schema.ts";
import type { CheckResult, RunContext, ToolDefinition, ToolResult } from "../harness/types.ts";

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
  if (!filenameMatch) {
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
