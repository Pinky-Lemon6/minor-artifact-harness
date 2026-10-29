import { z } from "zod";

export type CheckId = "version" | "required_files" | "integrity" | "forbidden" | "changelog";
export type CheckStatus = "pass" | "fail" | "warn" | "skip";
export type RunStatus = "pass" | "warn" | "fail" | "error";
export type RunMode = "agent" | "fixed";
export type SkillSelection = "auto" | "preload";

export type HarnessConfig = {
  harness: {
    maxSteps: number;
    skillDirs: string[];
    activeSkills: string[];
    skillSelection: SkillSelection;
    toolAllowlist: string[];
    enforceRequiredChecks: boolean;
  };
  model: {
    adapter: "mock" | "openai-compat";
    mock: { planFile: string };
    openaiCompat: { baseUrl: string; apiKeyEnv: string; model: string; temperature: number };
  };
  flow: { mode: RunMode; stages: { tool: string }[] };
  checks: {
    requiredFiles: string[];
    forbiddenPatterns: string[];
    scanContent: boolean;
    contentScanSeverity: "warn" | "fail";
    allowedBumps: ("major" | "minor" | "patch")[];
    changelogFile: string;
    allowExtraFiles: boolean;
    checkFilenameVersion: boolean;
  };
  report: { outputDir: string; formats: ("json" | "markdown")[]; template: string };
  runs: { retainArtifacts: boolean };
  server: { host: string; port: number };
};

export type ConfigOverride = {
  harness?: Partial<HarnessConfig["harness"]>;
  model?: Partial<HarnessConfig["model"]>;
  flow?: Partial<HarnessConfig["flow"]>;
  checks?: Partial<HarnessConfig["checks"]>;
  report?: Partial<HarnessConfig["report"]>;
  runs?: Partial<HarnessConfig["runs"]>;
  server?: Partial<HarnessConfig["server"]>;
};

const harnessSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(100),
    skillDirs: z.array(z.string()),
    activeSkills: z.array(z.string()),
    skillSelection: z.enum(["auto", "preload"]),
    toolAllowlist: z.array(z.string()),
    enforceRequiredChecks: z.boolean(),
  })
  .strict();

const modelSchema = z
  .object({
    adapter: z.enum(["mock", "openai-compat"]),
    mock: z.object({ planFile: z.string() }).strict(),
    openaiCompat: z
      .object({
        baseUrl: z.string(),
        apiKeyEnv: z.string(),
        model: z.string(),
        temperature: z.number(),
      })
      .strict(),
  })
  .strict();

const flowSchema = z
  .object({
    mode: z.enum(["agent", "fixed"]),
    stages: z.array(z.object({ tool: z.string() }).strict()),
  })
  .strict();

const checksSchema = z
  .object({
    requiredFiles: z.array(z.string()),
    forbiddenPatterns: z.array(z.string()),
    scanContent: z.boolean(),
    contentScanSeverity: z.enum(["warn", "fail"]),
    allowedBumps: z.array(z.enum(["major", "minor", "patch"])),
    changelogFile: z.string(),
    allowExtraFiles: z.boolean(),
    checkFilenameVersion: z.boolean(),
  })
  .strict();

const reportSchema = z
  .object({
    outputDir: z.string(),
    formats: z.array(z.enum(["json", "markdown"])).min(1),
    template: z.string(),
  })
  .strict();

const runsSchema = z.object({ retainArtifacts: z.boolean() }).strict();

const serverSchema = z
  .object({
    host: z.string(),
    port: z.number().int().min(0).max(65535),
  })
  .strict();

export const configSchema = z
  .object({
    harness: harnessSchema,
    model: modelSchema,
    flow: flowSchema,
    checks: checksSchema,
    report: reportSchema,
    runs: runsSchema,
    server: serverSchema,
  })
  .strict();

export const defaultConfig: HarnessConfig = {
  harness: {
    maxSteps: 16,
    skillDirs: ["skills"],
    activeSkills: ["minor-artifact-check"],
    skillSelection: "auto",
    toolAllowlist: [],
    enforceRequiredChecks: true,
  },
  model: {
    adapter: "mock",
    mock: { planFile: "fixtures/plans/agent-full-check.json" },
    openaiCompat: {
      baseUrl: "https://api.example.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      model: "your-model",
      temperature: 0,
    },
  },
  flow: {
    mode: "agent",
    stages: [
      { tool: "artifact.open" },
      { tool: "artifact.manifest" },
      { tool: "checks.version" },
      { tool: "checks.required_files" },
      { tool: "checks.integrity" },
      { tool: "checks.forbidden" },
      { tool: "checks.changelog" },
      { tool: "report.write" },
    ],
  },
  checks: {
    requiredFiles: ["manifest.json", "README.md", "LICENSE", "CHANGELOG.md"],
    forbiddenPatterns: ["*.env", "*.pem", "*.key", "id_rsa*"],
    scanContent: false,
    contentScanSeverity: "warn",
    allowedBumps: ["minor", "patch"],
    changelogFile: "CHANGELOG.md",
    allowExtraFiles: false,
    checkFilenameVersion: true,
  },
  report: {
    outputDir: "runs",
    formats: ["json", "markdown"],
    template: "skills/minor-artifact-check/assets/report-template.md",
  },
  runs: { retainArtifacts: true },
  server: { host: "127.0.0.1", port: 4317 },
};

export class ConfigError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigError";
    this.cause = cause;
  }
}

export function validateConfig(raw: unknown): HarnessConfig {
  try {
    return configSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ConfigError(message, error);
    }
    throw error;
  }
}

export function mergeConfig(base: HarnessConfig, override: ConfigOverride): HarnessConfig {
  return {
    harness: { ...base.harness, ...(override.harness ?? {}) },
    model: {
      ...base.model,
      ...(override.model ?? {}),
      mock: { ...base.model.mock, ...(override.model?.mock ?? {}) },
      openaiCompat: { ...base.model.openaiCompat, ...(override.model?.openaiCompat ?? {}) },
    },
    flow: {
      ...base.flow,
      ...(override.flow ?? {}),
      stages: override.flow?.stages ?? base.flow.stages,
    },
    checks: { ...base.checks, ...(override.checks ?? {}) },
    report: { ...base.report, ...(override.report ?? {}) },
    runs: { ...base.runs, ...(override.runs ?? {}) },
    server: { ...base.server, ...(override.server ?? {}) },
  };
}
