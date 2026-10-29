import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TraceEvent, TraceWriter } from "./types.ts";

export function createTraceWriter(runDir: string): TraceWriter {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, "trace.jsonl");
  return {
    write(event: TraceEvent): void {
      appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
    },
    close(): void {
      // appendFileSync writes synchronously; nothing to flush.
    },
  };
}
