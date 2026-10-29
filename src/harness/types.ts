import type { z } from "zod";
import type {
  CheckId,
  CheckStatus,
  ConfigOverride,
  HarnessConfig,
  RunMode,
  RunStatus,
  SkillSelection,
} from "../config/schema.ts";
import type { ToolRegistry } from "../tools/registry.ts";

export type ManifestFile = { path: string; sha256: string; size: number };
export type Manifest = { name: string; version: string; files: ManifestFile[]; changelog?: string };

export type RunInputs = {
  artifactSource: "fixture" | "upload";
  fixture?: string;
  uploadPath?: string;
  artifactFilename: string;
  declaredVersion: string;
  previousVersion: string;
  mode: RunMode;
  skillSelection?: SkillSelection;
  overrides?: ConfigOverride;
};

export type CheckResult = {
  id: CheckId;
  title: string;
  status: CheckStatus;
  required: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export type Report = {
  runId: string;
  status: RunStatus;
  incomplete: boolean;
  reason?: string;
  artifact: { filename: string; sha256: string; size: number } | null;
  versions: { declared: string; previous: string; manifest?: string };
  mode: RunMode;
  skill: { name: string; version: number } | null;
  checks: CheckResult[];
  summary: { passed: number; failed: number; warnings: number; skipped: number; durationMs: number };
  startedAt: string;
  finishedAt: string;
  configHash: string;
  fallback: boolean;
};

export type ToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: { code: string; message: string };
};

export type ToolDescriptor = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolDefinition<Args = unknown> = ToolDescriptor & {
  schema: z.ZodType<Args>;
  execute(args: Args, ctx: RunContext): Promise<ToolResult>;
  meta?: boolean;
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool"; tool: string; content: string };

export type ModelResponse =
  | { type: "tool_call"; tool: string; args: unknown; thought?: string }
  | { type: "final"; content: string };

export type ModelAdapter = {
  name: string;
  complete(input: { messages: ChatMessage[]; tools: ToolDescriptor[] }): Promise<ModelResponse>;
};

export type RunContext = {
  runId: string;
  runDir: string;
  inputs: RunInputs;
  config: HarnessConfig;
  registry: ToolRegistry;
  workspace: string | null;
  artifact: { filename: string; sha256: string; size: number } | null;
  manifest: Manifest | null;
  checkResults: Map<CheckId, CheckResult>;
  loadedSkills: Map<string, LoadedSkill>;
  activeToolNames: Set<string>;
  model: ModelAdapter;
  trace: TraceWriter;
  startedAt: number;
  reportWritten: boolean;
};

export type SkillMeta = { name: string; description: string; version: number; tools: string[] };
export type LoadedSkill = SkillMeta & { dir: string; body: string; files: string[] };

export type TraceEvent = {
  step: number;
  type: "prompt" | "model" | "tool_call" | "observation" | "final" | "error" | "enforced";
  tool?: string;
  args?: unknown;
  result?: unknown;
  durationMs?: number;
  error?: string;
};
export type TraceWriter = { write(event: TraceEvent): void; close(): void };

export type RunResult = {
  runId: string;
  runDir: string;
  status: RunStatus;
  incomplete: boolean;
  reason?: string;
  final: string;
  report: Report;
};

export const REQUIRED_CHECKS: CheckId[] = [
  "version",
  "required_files",
  "integrity",
  "forbidden",
  "changelog",
];
