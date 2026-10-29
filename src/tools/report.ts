import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Report, RunContext, ToolDefinition, ToolResult } from "../harness/types.ts";
import { buildReport } from "../harness/report.ts";

const BUILTIN_TEMPLATE = `# 小版本制品检测报告

- runId: {{runId}}
- 状态: {{status}}
- 制品: {{artifact}}
- 声明版本: {{declaredVersion}}
- 上一版本: {{previousVersion}}
- 生成时间: {{generatedAt}}

## 检查结果

{{checksTable}}

## 证据

{{evidence}}
`;

function checksTable(report: Report): string {
  const rows = report.checks.map(
    (check) => `| ${check.id} | ${check.status} | ${check.summary.replace(/\|/g, "\\|")} |`,
  );
  return ["| 检查项 | 状态 | 摘要 |", "|---|---|---|", ...rows].join("\n");
}

function evidenceBlock(report: Report): string {
  if (!report.checks.length) return "(无检查结果)";
  return report.checks
    .map(
      (check) =>
        `### ${check.id}\n\n\`\`\`json\n${JSON.stringify(check.evidence, null, 2)}\n\`\`\``,
    )
    .join("\n\n");
}

export function renderMarkdown(report: Report, template: string): string {
  const artifact = report.artifact
    ? `${report.artifact.filename} (${report.artifact.sha256.slice(0, 12)}…)`
    : "(none)";
  return template
    .replaceAll("{{runId}}", report.runId)
    .replaceAll("{{status}}", report.status)
    .replaceAll("{{artifact}}", artifact)
    .replaceAll("{{declaredVersion}}", report.versions.declared)
    .replaceAll("{{previousVersion}}", report.versions.previous)
    .replaceAll("{{checksTable}}", checksTable(report))
    .replaceAll("{{evidence}}", evidenceBlock(report))
    .replaceAll("{{generatedAt}}", report.finishedAt);
}

export async function ensureReport(
  ctx: RunContext,
  opts: { incomplete?: boolean; reason?: string; fallback?: boolean } = {},
): Promise<Report> {
  if (ctx.reportWritten) {
    try {
      return JSON.parse(readFileSync(join(ctx.runDir, "report.json"), "utf8")) as Report;
    } catch {
      // fall through and rebuild
    }
  }

  const report = buildReport(ctx, opts);
  writeFileSync(join(ctx.runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const templatePath = resolve(process.cwd(), ctx.config.report.template);
  const template = existsSync(templatePath) ? readFileSync(templatePath, "utf8") : BUILTIN_TEMPLATE;
  writeFileSync(join(ctx.runDir, "report.md"), renderMarkdown(report, template), "utf8");

  ctx.reportWritten = true;
  return report;
}

export const writeReportTool: ToolDefinition<Record<string, never>> = {
  name: "report.write",
  description: "Write report.json and report.md for this run.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  execute: async (_args, ctx: RunContext): Promise<ToolResult> => {
    const report = await ensureReport(ctx, { fallback: false });
    return {
      ok: true,
      summary: `report ${report.status} written`,
      data: { runId: report.runId, status: report.status, json: join(ctx.runDir, "report.json"), markdown: join(ctx.runDir, "report.md") },
    };
  },
};
