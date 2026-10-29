import { MockPlanAssertionError, MockPlanExhaustedError } from "../models/mock.ts";
import { ensureReport } from "../tools/report.ts";
import { buildSystemPrompt, buildUserPrompt, writePrompt } from "./prompt.ts";
import type { CheckId } from "../config/schema.ts";
import type { ChatMessage, RunContext, RunResult, ToolResult } from "./types.ts";
import { REQUIRED_CHECKS } from "./types.ts";

function missingChecks(ctx: RunContext): CheckId[] {
  return REQUIRED_CHECKS.filter((id) => !ctx.checkResults.has(id));
}

function canRun(ctx: RunContext, tool: string): boolean {
  return ctx.activeToolNames.has(tool) && ctx.registry.get(tool) !== undefined;
}

async function runEnforcedTool(ctx: RunContext, tool: string, step: number): Promise<ToolResult> {
  const started = Date.now();
  const result = await ctx.registry.execute(tool, {}, ctx);
  ctx.trace.write({
    step,
    type: "enforced",
    tool,
    result,
    durationMs: Date.now() - started,
  });
  return result;
}

export async function runAgent(ctx: RunContext): Promise<RunResult> {
  const system = buildSystemPrompt(ctx);
  const user = buildUserPrompt(ctx);
  writePrompt(ctx.runDir, system, user);
  ctx.trace.write({ step: 0, type: "prompt", result: { system, user } });

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let final = "";
  let incomplete = true;
  let reason: string | undefined;
  let step = 1;
  const enforceChecks = ctx.config.harness.enforceRequiredChecks;

  for (; step <= ctx.config.harness.maxSteps; step += 1) {
    let response;
    try {
      response = await ctx.model.complete({
        messages,
        tools: ctx.registry.descriptors(ctx.activeToolNames),
      });
    } catch (error) {
      if (error instanceof MockPlanExhaustedError) {
        reason = "mock_plan_exhausted";
      } else if (error instanceof MockPlanAssertionError) {
        reason = "plan_assertion_failed";
      } else {
        reason = "model_error";
      }
      break;
    }

    ctx.trace.write({ step, type: "model", result: response });

    if (response.type === "final") {
      const missing = missingChecks(ctx);
      if (enforceChecks && missing.length > 0) {
        const message = `missing required checks: ${missing.join(", ")}`;
        ctx.trace.write({ step, type: "enforced", result: { message } });
        messages.push({ role: "tool", tool: "harness", content: message });
        continue;
      }
      final = response.content;
      incomplete = missingChecks(ctx).length > 0;
      break;
    }

    const started = Date.now();
    const result = await ctx.registry.execute(response.tool, response.args, ctx);
    const durationMs = Date.now() - started;
    ctx.trace.write({ step, type: "tool_call", tool: response.tool, args: response.args });
    ctx.trace.write({
      step,
      type: "observation",
      tool: response.tool,
      result,
      durationMs,
    });

    messages.push({ role: "assistant" as const, content: JSON.stringify(response) });
    messages.push({
      role: "tool" as const,
      tool: response.tool,
      content: JSON.stringify(result),
    });
  }

  if (step > ctx.config.harness.maxSteps && reason === undefined) {
    reason = "max_steps";
    incomplete = true;

    if (enforceChecks) {
      if (!ctx.manifest && canRun(ctx, "artifact.manifest")) {
        await runEnforcedTool(ctx, "artifact.manifest", step);
      }

      for (const id of missingChecks(ctx)) {
        const tool = `checks.${id}`;
        if (!canRun(ctx, tool)) {
          reason = "required_check_unavailable";
          break;
        }
        await runEnforcedTool(ctx, tool, step);
      }
    }
  }

  if (enforceChecks && !ctx.artifact && (reason === undefined || reason === "max_steps")) {
    reason = "artifact_unreadable";
    incomplete = true;
  }

  const fallback = !ctx.reportWritten;
  const report = await ensureReport(ctx, { incomplete, reason, fallback });
  if (fallback) {
    ctx.trace.write({ step, type: "enforced", result: { report: "fallback" } });
  }
  ctx.trace.write({ step, type: "final", result: { final, status: report.status, reason } });

  return {
    runId: ctx.runId,
    runDir: ctx.runDir,
    status: report.status,
    incomplete: report.incomplete,
    reason: report.reason,
    final,
    report,
  };
}
