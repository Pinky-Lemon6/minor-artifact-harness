import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Report, TraceEvent } from "../harness/types.ts";

export type RunSummary = {
  runId: string;
  startedAt: string;
  status: string;
  artifact: string;
  mode: string;
};

export function assertRunId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid run id: ${id}`);
}

export function listRuns(runsDir: string, limit = 20): RunSummary[] {
  const root = resolve(runsDir);
  if (!existsSync(root)) return [];

  const runs: RunSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(root, entry.name, "report.json");
    if (!existsSync(reportPath)) continue;
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
      runs.push({
        runId: entry.name,
        startedAt: report.startedAt,
        status: report.status,
        artifact: report.artifact?.filename ?? "(none)",
        mode: report.mode,
      });
    } catch {
      // ignore malformed run directories
    }
  }

  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, limit);
}

export function readRun(runsDir: string, runId: string): { report: Report; trace: TraceEvent[] } {
  assertRunId(runId);
  const root = resolve(runsDir);
  const runDir = resolve(root, runId);
  if (!runDir.startsWith(`${root}${sep}`)) throw new Error(`invalid run id: ${runId}`);

  const report = JSON.parse(readFileSync(join(runDir, "report.json"), "utf8")) as Report;
  const tracePath = join(runDir, "trace.jsonl");
  const trace = existsSync(tracePath)
    ? readFileSync(tracePath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceEvent)
    : [];

  return { report, trace };
}
