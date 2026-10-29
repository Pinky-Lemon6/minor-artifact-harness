import { MockPlanAssertionError, MockPlanExhaustedError } from "../models/mock.ts";
import { ensureReport } from "../tools/report.ts";
import { buildSystemPrompt, buildUserPrompt, writePrompt } from "./prompt.ts";
import type { ChatMessage, RunContext, RunResult } from "./types.ts";
import { REQUIRED_CHECKS } from "./types.ts";

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
      final = response.content;
      incomplete = !REQUIRED_CHECKS.every((id) => ctx.checkResults.has(id));
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

  if (step > ctx.config.harness.maxSteps) {
    reason = "max_steps";
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
