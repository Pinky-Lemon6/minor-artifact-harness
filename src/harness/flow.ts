import { validatePolicy } from "../config/policy.ts";
import { ensureReport } from "../tools/report.ts";
import type { RunContext, RunResult } from "./types.ts";

export async function runFixed(ctx: RunContext): Promise<RunResult> {
  validatePolicy(ctx.config, new Set(ctx.registry.listNames()));
  ctx.activeToolNames = new Set(ctx.config.flow.stages.map((stage) => stage.tool));

  let step = 0;
  for (const stage of ctx.config.flow.stages) {
    step += 1;
    const started = Date.now();
    const result = await ctx.registry.execute(stage.tool, {}, ctx);
    const durationMs = Date.now() - started;
    ctx.trace.write({ step, type: "tool_call", tool: stage.tool, args: {} });
    ctx.trace.write({ step, type: "observation", tool: stage.tool, result, durationMs });
  }

  const fallback = !ctx.reportWritten;
  const report = await ensureReport(ctx, { incomplete: false, fallback });
  if (fallback) {
    ctx.trace.write({ step: step + 1, type: "enforced", result: { report: "fallback" } });
  }

  return {
    runId: ctx.runId,
    runDir: ctx.runDir,
    status: report.status,
    incomplete: report.incomplete,
    reason: report.reason,
    final: "固定流程完成",
    report,
  };
}
