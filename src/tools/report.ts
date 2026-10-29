import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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
  const values: Record<string, string> = {
    runId: report.runId,
    status: report.status,
    artifact,
    declaredVersion: report.versions.declared,
    previousVersion: report.versions.previous,
    checksTable: checksTable(report),
    evidence: evidenceBlock(report),
    generatedAt: report.finishedAt,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? `{{${key}}}`);
}

export async function ensureReport(
  ctx: RunContext,
  opts: { incomplete?: boolean; reason?: string; fallback?: boolean } = {},
): Promise<Report> {
  if (ctx.reportWritten && opts.incomplete === undefined && opts.reason === undefined) {
    try {
      return JSON.parse(readFileSync(join(ctx.runDir, "report.json"), "utf8")) as Report;
    } catch {
      // fall through and rebuild
    }
  }

  const report = buildReport(ctx, opts);
  const formats = ctx.config.report.formats;
  if (formats.includes("json")) {
    writeFileSync(join(ctx.runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const root = resolve(process.cwd());
  const templatePath = resolve(root, ctx.config.report.template);
  const usableTemplate =
    templatePath !== root &&
    templatePath.startsWith(`${root}${sep}`) &&
    existsSync(templatePath) &&
    statSync(templatePath).isFile();
  const template = usableTemplate ? readFileSync(templatePath, "utf8") : BUILTIN_TEMPLATE;
  if (formats.includes("markdown")) {
    writeFileSync(join(ctx.runDir, "report.md"), renderMarkdown(report, template), "utf8");
  }

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
