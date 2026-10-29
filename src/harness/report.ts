import { createHash } from "node:crypto";
import type { RunStatus } from "../config/schema.ts";
import type { CheckResult, Report, RunContext } from "./types.ts";
import { REQUIRED_CHECKS } from "./types.ts";

const ERROR_REASONS = new Set([
  "mock_plan_exhausted",
  "plan_assertion_failed",
  "model_error",
  "required_check_unavailable",
]);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildReport(
  ctx: RunContext,
  opts: { incomplete?: boolean; reason?: string; fallback?: boolean } = {},
): Report {
  const ordered: CheckResult[] = [];
  for (const id of REQUIRED_CHECKS) {
    const result = ctx.checkResults.get(id);
    if (result) ordered.push(result);
  }
  for (const result of ctx.checkResults.values()) {
    if (!REQUIRED_CHECKS.includes(result.id)) ordered.push(result);
  }

  const passed = ordered.filter((check) => check.status === "pass").length;
  const failed = ordered.filter((check) => check.status === "fail").length;
  const failedRequired = ordered.filter((check) => check.required && check.status === "fail").length;
  const warnings = ordered.filter((check) => check.status === "warn").length;
  const skipped = ordered.filter((check) => check.status === "skip").length;
  const incomplete = opts.incomplete ?? ordered.length < REQUIRED_CHECKS.length;
  const reason = opts.reason;

  let status: RunStatus;
  if (reason && ERROR_REASONS.has(reason)) {
    status = "error";
  } else if (failedRequired > 0) {
    status = "fail";
  } else if (incomplete || warnings > 0 || failed > 0) {
    status = "warn";
  } else {
    status = "pass";
  }

  const firstSkill = ctx.loadedSkills.values().next().value;

  return {
    runId: ctx.runId,
    status,
    incomplete,
    reason,
    artifact: ctx.artifact,
    versions: {
      declared: ctx.inputs.declaredVersion,
      previous: ctx.inputs.previousVersion,
      manifest: ctx.manifest?.version,
    },
    mode: ctx.inputs.mode,
    skill: firstSkill ? { name: firstSkill.name, version: firstSkill.version } : null,
    checks: ordered,
    summary: { passed, failed, warnings, skipped, durationMs: Date.now() - ctx.startedAt },
    startedAt: new Date(ctx.startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    configHash: createHash("sha256").update(stableStringify(ctx.config)).digest("hex"),
    fallback: opts.fallback ?? false,
  };
}
