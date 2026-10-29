# 小版本制品检测 Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable mini agent harness that inspects minor-release artifacts and teaches the full loop of harness tools, skills, configuration, and form design.

**Architecture:** Node 26 + TypeScript, no agent framework. A tool registry, a pluggable model adapter (MockModel first), a skill loader with progressive disclosure, layered YAML config, a filesystem run store, and a native HTML form. Agent mode and fixed-flow mode share the same tools, policy, and report format.

**Tech Stack:** Node.js 26, TypeScript (native type stripping), `zod`, `yaml`, `semver`, `minimatch`, `yauzl`; `yazl` / `fflate` for fixtures; `node:test`; `node:http`.

**Spec:** `docs/superpowers/specs/2026-10-29-minor-artifact-harness-design.md`

## Global Constraints

- Node.js >= 26, ESM (`"type": "module"`), imports use explicit `.ts` extensions.
- TypeScript must be erasable syntax only: no enums, namespaces, or parameter properties.
- Runtime dependencies: `yauzl`, `yaml`, `zod`, `semver`, `minimatch`. Dev dependencies: `typescript`, `@types/node`, `@types/yauzl`, `@types/semver`, `yazl`, `@types/yazl`, `fflate`.
- Tools never call the network. The HTTP server binds `127.0.0.1` only.
- Upload limit 10 MB; zip limits 2000 entries and 50 MB uncompressed; tool timeout 5 seconds.
- The five checks always run. Required checks are enforced by the harness, not only by the Skill.
- Policy (`requiredFiles`, `forbiddenPatterns`, `allowedBumps`, `scanContent`, `allowExtraFiles`, `changelogFile`) comes only from effective config. Tool args never loosen policy.
- `runs/`, `config/local.yaml`, `fixtures/build/`, and `node_modules/` are gitignored.
- Chinese docs and UI copy; English identifiers and test names.
- Conventional Commits; `main` is the integration branch.
- `npm test` runs offline; `npm run typecheck` must pass.

## Review Focus

These are the input classes most likely to break a user's trust; each has a test in the owning task.

1. **Malicious zip entries:** `../`, absolute paths, backslashes, symlinks, duplicate paths, >2000 entries, >50 MB uncompressed. Owning task: Task 6.
2. **Agent bypass:** model returns `final` before required checks, calls a tool outside its allowlist, or tries to loosen policy through tool args. Owning tasks: Tasks 4, 12.
3. **Path traversal outside a known root:** `skill.read` outside the skill directory, `runId` outside `runs/`, static file paths outside `web/`. Owning tasks: Tasks 11, 13.
4. **Version edge cases:** missing previous version, prerelease, major bump, invalid semver, filename without a version, absent `package.json`, CRLF changelog. Owning tasks: Tasks 7, 9.
5. **Config layering:** arrays replace instead of merge, `local.yaml` overrides `default.yaml`, per-run overrides do not persist, a non-empty allowlist or flow that omits a required tool is rejected. Owning tasks: Tasks 2, 12.

## Shared Types and Interfaces

Create these in Task 1/2/3; later tasks rely on the exact names.

```ts
// src/config/schema.ts
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
```

```ts
// src/harness/types.ts
import type { z } from "zod";
import type { CheckId, CheckStatus, ConfigOverride, HarnessConfig, RunMode, RunStatus, SkillSelection } from "../config/schema.ts";
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

export const REQUIRED_CHECKS: CheckId[] = ["version", "required_files", "integrity", "forbidden", "changelog"];
```

---

### Task 1: Repository scaffold, scripts, and CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `.github/workflows/ci.yml`, `src/version.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `HARNESS_NAME = "minor-artifact-harness"`; npm scripts `test`, `typecheck`, `inspect`, `demo`, `dev`, `fixtures`.

- [ ] **Step 1: Write the failing smoke test**

```ts
// tests/smoke.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { HARNESS_NAME } from "../src/version.ts";

test("harness name is stable", () => {
  assert.equal(HARNESS_NAME, "minor-artifact-harness");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL with a module-not-found error for `src/version.ts`.

- [ ] **Step 3: Create the scaffold**

`package.json` scripts:

```json
{
  "name": "minor-artifact-harness",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=26" },
  "scripts": {
    "test": "node --test tests/*.test.ts",
    "typecheck": "tsc --noEmit",
    "inspect": "node src/cli.ts inspect",
    "demo": "node src/cli.ts demo",
    "dev": "node src/cli.ts serve",
    "fixtures": "node fixtures/make-fixtures.ts"
  }
}
```

`tsconfig.json` must set `strict`, `noEmit`, `module: "nodenext"`, `moduleResolution: "nodenext"`, `target: "es2024"`, `allowImportingTsExtensions: true`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `types: ["node"]`.

`src/version.ts`:

```ts
export const HARNESS_NAME = "minor-artifact-harness";
```

`.gitignore` includes `node_modules/`, `runs/`, `fixtures/build/`, `config/local.yaml`, `*.log`, `.DS_Store`.

`README.md` contains the title, one-paragraph purpose, the four commands, and a link to the spec.

`.github/workflows/ci.yml` runs on push and pull request, uses `actions/setup-node@v4` with Node 26, then `npm ci`, `npm run typecheck`, `npm test`.

Install dependencies:

```bash
npm install yauzl yaml zod semver minimatch
npm install -D typescript @types/node @types/yauzl @types/semver yazl @types/yazl fflate
```

- [ ] **Step 4: Run test and typecheck to verify they pass**

Run: `npm test && npm run typecheck`
Expected: 1 test passes; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore README.md .github src/version.ts tests/smoke.test.ts
git commit -m "chore: scaffold project, scripts, and CI"
```

---

### Task 2: Config schema, defaults, merge, and layered loading

**Files:**
- Create: `src/config/schema.ts`, `src/config/load.ts`, `config/default.yaml`, `config/local.yaml.example`, `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `HarnessConfig`, `ConfigOverride`, `CheckId`, `CheckStatus`, `RunStatus`, `RunMode`, `SkillSelection`, `defaultConfig`, `configSchema`, `mergeConfig(base, override)`, `validateConfig(raw)`, `loadConfig({ cwd?, overrides? })`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, mergeConfig, validateConfig } from "../src/config/schema.ts";
import { loadConfig } from "../src/config/load.ts";

test("default config validates", () => {
  assert.deepEqual(validateConfig(defaultConfig), defaultConfig);
});

test("arrays replace instead of merging", () => {
  const merged = mergeConfig(defaultConfig, { checks: { requiredFiles: ["only.txt"] } });
  assert.deepEqual(merged.checks.requiredFiles, ["only.txt"]);
  assert.equal(merged.checks.scanContent, defaultConfig.checks.scanContent);
});

test("invalid maxSteps reports its path", () => {
  assert.throws(() => validateConfig({ ...defaultConfig, harness: { ...defaultConfig.harness, maxSteps: 0 } }), /harness\.maxSteps/);
});

test("local.yaml overrides default.yaml", async () => {
  const root = await mkdtemp(join(tmpdir(), "mah-config-"));
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config/default.yaml"), "harness:\n  maxSteps: 16\n");
  await writeFile(join(root, "config/local.yaml"), "harness:\n  maxSteps: 4\n");
  assert.equal(loadConfig({ cwd: root }).harness.maxSteps, 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/config.test.ts`
Expected: FAIL with module-not-found for `src/config/schema.ts`.

- [ ] **Step 3: Implement schema, merge, loader, and YAML defaults**

`src/config/schema.ts` defines the types from Shared Types, `defaultConfig` matching the spec's YAML, and a zod schema. Use `.strict()` on nested objects so unknown keys fail with a path. `validateConfig(raw)` returns the parsed config or throws `ZodError`; do not catch it.

`src/config/load.ts` implements:

```ts
export function mergeConfig(base: HarnessConfig, override: ConfigOverride): HarnessConfig;
export function loadConfig(opts?: { cwd?: string; overrides?: ConfigOverride }): HarnessConfig;
```

`mergeConfig` merges each top-level section shallowly and replaces arrays wholesale. `loadConfig` reads `config/default.yaml` when present (otherwise uses `defaultConfig`), then optional `config/local.yaml`, then `overrides`, then validates.

`config/default.yaml` mirrors `defaultConfig` exactly. `config/local.yaml.example` shows the same keys commented out.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config config tests/config.test.ts
git commit -m "feat(config): add schema, defaults, and layered loading"
```

---

### Task 3: Tool registry, trace writer, and a demo tool

**Files:**
- Create: `src/harness/types.ts`, `src/tools/registry.ts`, `src/harness/trace.ts`, `src/tools/demo.ts`, `tests/registry.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig`, `CheckId`, etc. from Task 2.
- Produces: `ToolRegistry`, `ToolRegistry.descriptors(allowed)`, `ToolDefinition`, `ToolDescriptor`, `ToolResult`, `TraceWriter`, `createTraceWriter(runDir)`, `demoEchoTool`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ToolRegistry } from "../src/tools/registry.ts";
import { createTraceWriter } from "../src/harness/trace.ts";
import type { ToolDefinition } from "../src/harness/types.ts";

const echo: ToolDefinition<{ text: string }> = {
  name: "demo.echo",
  description: "Echo text",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  schema: z.object({ text: z.string() }),
  execute: async (args) => ({ ok: true, summary: args.text, data: args }),
};

test("registers and executes an allowed tool", async () => {
  const registry = new ToolRegistry();
  registry.register(echo);
  const result = await registry.execute("demo.echo", { text: "hi" }, ctxWith(registry, ["demo.echo"]));
  assert.equal(result.ok, true);
  assert.equal(result.summary, "hi");
});

test("rejects unknown and unauthorized tools", async () => {
  const registry = new ToolRegistry();
  registry.register(echo);
  const unknown = await registry.execute("nope", {}, ctxWith(registry, ["demo.echo"]));
  const denied = await registry.execute("demo.echo", { text: "x" }, ctxWith(registry, []));
  assert.equal(unknown.error?.code, "unknown_tool");
  assert.equal(denied.error?.code, "tool_not_allowed");
});

test("invalid args and thrown errors become structured results", async () => {
  const registry = new ToolRegistry();
  registry.register(echo);
  const invalid = await registry.execute("demo.echo", {}, ctxWith(registry, ["demo.echo"]));
  assert.equal(invalid.error?.code, "invalid_args");
  const boom: ToolDefinition = { ...echo, name: "boom", execute: async () => { throw new Error("kaboom"); } };
  registry.register(boom);
  const failed = await registry.execute("boom", {}, ctxWith(registry, ["boom"]));
  assert.equal(failed.error?.code, "tool_error");
  assert.match(failed.error!.message, /kaboom/);
});

test("trace writes one JSON object per line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mah-trace-"));
  const trace = createTraceWriter(dir);
  trace.write({ step: 1, type: "tool_call", tool: "demo.echo" });
  trace.close();
  const lines = (await readFile(join(dir, "trace.jsonl"), "utf8")).trim().split("\n");
  assert.equal(JSON.parse(lines[0]).tool, "demo.echo");
});
```

Use a local `ctxWith(registry, allowed)` helper in the test that returns the minimal `RunContext` shape (cast as needed) with `activeToolNames: new Set(allowed)`. The test may use `as unknown as RunContext`; keep it local.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/registry.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement types, registry, trace, and demo tool**

`ToolRegistry.execute(name, args, ctx)`:

1. Look up the tool; if missing → `{ ok: false, error: { code: "unknown_tool", ... } }`.
2. If `!ctx.activeToolNames.has(name)` → `tool_not_allowed`.
3. `tool.schema.safeParse(args)`; on failure → `invalid_args` with `error.issues`.
4. Race the execution against a 5-second timeout → `timeout`.
5. Catch exceptions → `tool_error` with the message.
6. Return the tool result.

`ToolRegistry.descriptors(allowed)` returns `{ name, description, parameters }` for registered tools whose names are in `allowed`, in registration order. This is what the prompt and the model see.

`createTraceWriter(runDir)` creates `runDir/trace.jsonl` and appends `JSON.stringify(event) + "\n"` synchronously. `close()` ends the stream.

`src/tools/demo.ts` exports `demoEchoTool` with the same shape as the test tool.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/harness/types.ts src/tools/registry.ts src/harness/trace.ts src/tools/demo.ts tests/registry.test.ts
git commit -m "feat(harness): add tool registry and trace writer"
```

---

### Task 4: Prompt assembly, MockModel, agent loop, and minimal report

**Files:**
- Create: `src/harness/constants.ts`, `src/harness/context.ts`, `src/harness/prompt.ts`, `src/harness/report.ts`, `src/harness/loop.ts`, `src/models/mock.ts`, `fixtures/plans/demo.json`, `tests/helpers.ts`, `tests/harness.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`, `TraceWriter`, `RunInputs`, `HarnessConfig`, `ToolDefinition` from Task 3.
- Produces: `createRunContext(opts)`, `buildSystemPrompt(ctx)`, `buildUserPrompt(ctx)`, `writePrompt(runDir, system, user)`, `MockModel`, `loadMockPlan(path, inputs)`, `runAgent(ctx)`, `buildReport(ctx, opts?)`, `RunResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/harness.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../src/tools/registry.ts";
import { demoEchoTool } from "../src/tools/demo.ts";
import { MockModel, loadMockPlan } from "../src/models/mock.ts";
import { runAgent } from "../src/harness/loop.ts";
import { createRunContext } from "../src/harness/context.ts";
import { defaultConfig } from "../src/config/schema.ts";

test("mock model resolves placeholders and the loop records a full trace", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "mah-run-"));
  const planPath = join(runDir, "plan.json");
  await writeFile(planPath, JSON.stringify([
    { type: "tool_call", tool: "demo.echo", args: { text: "hello ${declaredVersion}" } },
    { type: "final", content: "done" },
  ]));
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  const config = structuredClone(defaultConfig);
  config.harness.maxSteps = 5;
  const model = new MockModel(loadMockPlan(planPath, baseInputs()));
  const ctx = await createRunContext({ runId: "r1", runDir, inputs: baseInputs(), config, model, registry });
  ctx.activeToolNames.add("demo.echo");
  const result = await runAgent(ctx);
  assert.equal(result.final, "done");
  assert.equal(result.report.checks.length, 0);
  assert.equal(result.report.incomplete, true);
  const trace = await readFile(join(runDir, "trace.jsonl"), "utf8");
  assert.match(trace, /hello 1\.5\.0/);
  assert.match(trace, /"type":"tool_call"/);
  assert.match(trace, /"type":"observation"/);
  assert.match(await readFile(join(runDir, "prompt.md"), "utf8"), /demo\.echo/);
});

test("maxSteps writes a warn, incomplete report", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "mah-run-"));
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  const config = structuredClone(defaultConfig);
  config.harness.maxSteps = 1;
  const model = new MockModel([
    { type: "tool_call", tool: "demo.echo", args: { text: "one" } },
    { type: "tool_call", tool: "demo.echo", args: { text: "two" } },
  ]);
  const ctx = await createRunContext({ runId: "r2", runDir, inputs: baseInputs(), config, model, registry });
  ctx.activeToolNames.add("demo.echo");
  const result = await runAgent(ctx);
  assert.equal(result.status, "warn");
  assert.equal(result.report.incomplete, true);
  assert.equal(result.report.reason, "max_steps");
});

test("plan exhaustion becomes an error report", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "mah-run-"));
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  const ctx = await createRunContext({
    runId: "r3", runDir, inputs: baseInputs(), config: structuredClone(defaultConfig),
    model: new MockModel([]), registry,
  });
  const result = await runAgent(ctx);
  assert.equal(result.status, "error");
  assert.equal(result.report.reason, "mock_plan_exhausted");
});
```

Define `baseInputs()` in `tests/helpers.ts` and import it here; Task 12 reuses it. It returns `{ artifactSource: "fixture", fixture: "good", artifactFilename: "demo-app-1.5.0.zip", declaredVersion: "1.5.0", previousVersion: "1.4.2", mode: "agent" }` and accepts a partial override.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/harness.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement context, prompt, mock model, loop, and report**

`createRunContext` creates the run directory, trace writer, `checkResults` map, `loadedSkills` map, and `activeToolNames`. For `agent` + `auto`, start with `new Set(["skill.load", "skill.read"])`; for `preload`, add the active skill tools later (Task 11); for `fixed`, start with the flow stage tools.

`buildSystemPrompt` includes: harness role, current mode, available skill metadata (empty until Task 11), active skill bodies, tool descriptors for `ctx.activeToolNames`, and the JSON output protocol. `buildUserPrompt` includes the artifact filename, declared version, previous version, mode, and the instruction to run the inspection. `writePrompt` writes `prompt.md` as `# System\n...\n# User\n...`.

`MockModel` takes a plan array. A plan step is `{ type: "tool_call", tool, args?, expect?: { contains?: string } } | { type: "final", content }`. `loadMockPlan(path, inputs)` reads JSON and replaces `${declaredVersion}`, `${previousVersion}`, `${fixture}`, `${artifactFilename}`. On exhaustion, throw `MockPlanExhaustedError`; on an `expect.contains` mismatch against the last message, throw `MockPlanAssertionError`.

`runAgent(ctx)`:

```ts
export async function runAgent(ctx: RunContext): Promise<RunResult>;
```

1. Build and write the prompt.
2. Loop up to `ctx.config.harness.maxSteps`.
3. Call `ctx.model.complete({ messages, tools: ctx.registry.descriptors(ctx.activeToolNames) })`.
4. On `final`: stop. Required-check enforcement is added in Task 12; until then, a final with missing checks yields an incomplete report.
5. On `tool_call`: execute, append assistant/tool messages, trace both.
6. On `max_steps`: stop with `reason: "max_steps"`.
7. On `MockPlanExhaustedError` / `MockPlanAssertionError`: stop with `status: "error"` and the matching reason.
8. Build the report via `buildReport(ctx, { incomplete, reason })`; return `RunResult`.

`buildReport` computes status: `error` if `reason` is a harness error; `fail` if any required check failed; `warn` if incomplete or any warn; else `pass`. `configHash` uses a stable `JSON.stringify` with sorted keys (small local helper). `fallback` defaults to `false`; `reportWritten` defaults to `false`.

`fixtures/plans/demo.json` contains one `demo.echo` call and one final.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/harness src/models fixtures/plans tests/helpers.ts tests/harness.test.ts
git commit -m "feat(harness): add prompt assembly, mock model, and agent loop"
```

---

### Task 5: Run executor and CLI demo

**Files:**
- Create: `src/harness/execute.ts`, `src/cli.ts`, `tests/cli.test.ts`

**Interfaces:**
- Consumes: `runAgent`, `createRunContext`, `MockModel`, `loadMockPlan`, `loadConfig`.
- Produces: `executeRun(opts: { inputs: RunInputs; config: HarnessConfig; cwd?: string }): Promise<RunResult>`; CLI commands `demo`, `serve`, `inspect`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("cli demo exits 0 and prints the final answer", () => {
  const result = spawnSync(process.execPath, ["src/cli.ts", "demo"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /done/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node src/cli.ts demo`
Expected: fails because `src/cli.ts` does not exist.

- [ ] **Step 3: Implement `executeRun` and the CLI**

`executeRun`:

1. Validate inputs (`declaredVersion` and `previousVersion` non-empty; fixture or upload path present).
2. Create `runId` as `YYYYMMDD-HHmmss-<6 hex>`; `runDir = resolve(cwd, config.report.outputDir, runId)`.
3. Build the model from config: for `mock`, `new MockModel(loadMockPlan(config.model.mock.planFile, inputs))`.
4. Create a registry with the demo tool (later tasks replace this with `createRegistry()` from `src/tools/index.ts`).
5. `createRunContext`, then `runAgent` (or `runFixed` after Task 12).
6. Return the result.

When `config.harness.activeSkills` is empty, `createRunContext` starts with every registered tool name in `activeToolNames` (this is the demo/no-skill mode). When it is non-empty, start with the Skill meta tools only; Task 11 adds the loaded Skill tools.

`src/cli.ts` uses `node:util.parseArgs`:

```bash
node src/cli.ts demo
node src/cli.ts inspect --fixture good --version 1.5.0 --previous 1.4.2 --mode agent
node src/cli.ts inspect --zip path/to/artifact.zip --version 1.5.0 --previous 1.4.2
node src/cli.ts serve --port 4317
```

For `demo`, clone `defaultConfig`, set `harness.activeSkills = []` and `model.mock.planFile = "fixtures/plans/demo.json"`, run, print `final` and the run directory. For `inspect`, use the same executor; the real tools arrive in later tasks. For `serve`, print a message that the server arrives in Task 13 (exit 0). Use exit codes: `0` for pass, `1` for fail/warn, `2` for error.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: CLI test passes.

- [ ] **Step 5: Commit**

```bash
git add src/harness/execute.ts src/cli.ts tests/cli.test.ts
git commit -m "feat(cli): add run executor and demo command"
```

---

### Task 6: Safe artifact reading, artifact tools, and fixtures

**Files:**
- Create: `src/util/hash.ts`, `src/util/zip.ts`, `src/tools/artifact.ts`, `src/tools/index.ts`, `fixtures/make-fixtures.ts`, `fixtures/good/*`, `fixtures/bad-version/*`, `fixtures/bad-hash/*`, `fixtures/forbidden/*`, `fixtures/missing-file/*`, `tests/artifact.test.ts`
- Modify: `src/harness/execute.ts`

**Interfaces:**
- Consumes: `ToolDefinition`, `RunContext`, `Manifest`.
- Produces: `sha256(bytes)`, `readZip(bytes, limits): Promise<ZipEntry[]>`, `writeZip(entries, opts?): Uint8Array`, `openArtifactTool`, `readManifestTool`, `createRegistry(): ToolRegistry`, `buildFixture(name): Uint8Array`, `ensureFixtures(): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/artifact.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readZip, writeZip } from "../src/util/zip.ts";
import { openArtifactTool } from "../src/tools/artifact.ts";

test("readZip rejects path traversal and absolute paths", async () => {
  const zip = writeZip({ "../evil.txt": new TextEncoder().encode("x") });
  await assert.rejects(() => readZip(zip, { maxEntries: 10, maxUncompressedBytes: 1000 }), /path traversal/i);
  const absolute = writeZip({ "/etc/passwd": new TextEncoder().encode("x") });
  await assert.rejects(() => readZip(absolute, { maxEntries: 10, maxUncompressedBytes: 1000 }), /absolute path/i);
});

test("readZip rejects symlink entries", async () => {
  const zip = makeSymlinkZip("link", "/etc/passwd");
  await assert.rejects(() => readZip(zip, { maxEntries: 10, maxUncompressedBytes: 1000 }), /symlink/i);
});

test("readZip enforces entry and size limits", async () => {
  const tooMany = writeZip({
    "a.txt": new Uint8Array([1]),
    "b.txt": new Uint8Array([1]),
    "c.txt": new Uint8Array([1]),
  });
  await assert.rejects(() => readZip(tooMany, { maxEntries: 2, maxUncompressedBytes: 1000 }), /too many entries/i);
  const tooLarge = writeZip({ "a.txt": new Uint8Array(2000) });
  await assert.rejects(() => readZip(tooLarge, { maxEntries: 10, maxUncompressedBytes: 1000 }), /too large/i);
});

test("artifact.open extracts the good fixture and records its hash", async () => {
  const ctx = await baseCtx();
  const result = await openArtifactTool.execute({ source: "fixture", fixture: "good" }, ctx);
  assert.equal(result.ok, true);
  assert.equal(ctx.artifact?.sha256.length, 64);
  assert.ok(existsSync(join(ctx.workspace!, "manifest.json")));
});
```

Define `makeSymlinkZip` in the test using `yazl` with `mode: 0o120777`; `writeZip` can use `fflate`. `baseCtx()` creates a temp run dir, a context with `defaultConfig` and a registry containing the artifact tools, and calls `ensureFixtures()` first. If `fflate` normalizes `../` when writing the malicious zip, build that fixture with `yazl` instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/artifact.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement zip utilities, artifact tools, and fixture builder**

`readZip` uses `yauzl.fromBuffer` with `lazyEntries: true`. For each entry:

- Reject if `fileName` starts with `/`, contains a drive letter, contains `\`, or has a `..` segment.
- Reject symlink entries by checking `(entry.externalFileAttributes >>> 16) & 0o170000 === 0o120000`.
- Track total uncompressed size (`entry.uncompressedSize`) and entry count before reading.
- Reject duplicate normalized paths.
- Return `{ path, bytes }[]` sorted by path.

`writeZip` uses `fflate.zipSync` and accepts `Record<string, Uint8Array>`.

`openArtifactTool` (`artifact.open`) args `{ source?: "fixture" | "upload", fixture?: string }`; when omitted, default from `ctx.inputs.artifactSource` / `ctx.inputs.fixture`:

- Resolve the zip path: `fixtures/build/<fixture>.zip` or `ctx.inputs.uploadPath`.
- Read bytes, `sha256`, `readZip` with limits, write files under `ctx.workspace` (create it under `runDir/workspace`), set `ctx.artifact`, return the file list and hash.
- Reject if `ctx.workspace` is already set (single open per run).

`readManifestTool` (`artifact.manifest`) reads `ctx.workspace/manifest.json`, parses it, validates `name: string`, `version: string`, `files: {path,sha256,size}[]`, sets `ctx.manifest`, returns it. On missing/invalid, return a structured `fail` result with a clear message.

`fixtures/make-fixtures.ts` builds five fixture source trees into `fixtures/build/*.zip` using `writeZip`:

- `good`: all required files, manifest listing every payload file, matching hashes, changelog with `## [1.5.0]`.
- `bad-version`: manifest says `1.4.0` while the declared version is `1.5.0`.
- `bad-hash`: manifest hash for `dist/app.js` is wrong.
- `forbidden`: includes `.env` and `config/prod.key`; manifest lists them.
- `missing-file`: manifest lists `LICENSE` but the zip lacks it.

`ensureFixtures()` builds all five if `fixtures/build/` is missing and returns the build directory.

`src/tools/index.ts` exports `createRegistry()` and registers the demo tool plus `openArtifactTool` and `readManifestTool`. Later tasks add checks, report, and skill tools to this function. `executeRun` replaces its temporary demo registry with `createRegistry()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: artifact tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/util src/tools src/harness/execute.ts fixtures tests/artifact.test.ts
git commit -m "feat(tools): add safe zip reading and artifact tools"
```

---

### Task 7: Version consistency check

**Files:**
- Create: `src/tools/checks.ts` (version function only), `tests/checks-version.test.ts`
- Modify: `src/tools/index.ts`

**Interfaces:**
- Consumes: `RunContext`, `CheckResult`, `Manifest`, `semver`.
- Produces: `checkVersion(ctx): Promise<CheckResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/checks-version.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVersion } from "../src/tools/checks.ts";

test("matching versions pass", async () => {
  const result = await checkVersion(await ctxFor("good", { declared: "1.5.0", previous: "1.4.2" }));
  assert.equal(result.status, "pass");
});

test("manifest mismatch fails", async () => {
  const result = await checkVersion(await ctxFor("bad-version", { declared: "1.5.0", previous: "1.4.2" }));
  assert.equal(result.status, "fail");
  assert.match(result.summary, /manifest/i);
});

test("major bump fails; patch and minor pass", async () => {
  assert.equal((await checkVersion(await ctxFor("good", { declared: "2.0.0", previous: "1.4.2" }))).status, "fail");
  assert.equal((await checkVersion(await ctxFor("good", { declared: "1.4.3", previous: "1.4.2" }))).status, "pass");
  assert.equal((await checkVersion(await ctxFor("good", { declared: "1.6.0", previous: "1.4.2" }))).status, "pass");
});

test("missing previous version fails; absent package.json and unparsable filename are skips", async () => {
  assert.equal((await checkVersion(await ctxFor("good", { declared: "1.5.0", previous: "" }))).status, "fail");
  const result = await checkVersion(await ctxFor("good", { declared: "1.5.0", previous: "1.4.2", filename: "artifact.zip" }));
  assert.equal((result.evidence.filenameVersion as any).status, "skip");
});
```

`ctxFor(fixture, opts)` is a test helper that creates a run context, runs `artifact.open` and `artifact.manifest` against `fixtures/build/<fixture>.zip`, and returns the context.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/checks-version.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `checkVersion`**

Rules:

- `declaredVersion` is authoritative and required; empty → `fail` with "missing declared version".
- `manifest.version` must equal declared; missing/invalid → `fail`.
- If `package.json` exists, its `version` must equal declared; absent → sub-check `skip`.
- Extract a semver from `ctx.artifact.filename` (`/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/`); if absent → sub-check `skip`; if present and different → `fail`.
- `previousVersion` required; empty or invalid → `fail`.
- `semver.diff(previous, declared)` must be in `ctx.config.checks.allowedBumps`; `major`, `premajor`, `preminor`, `prepatch`, `prerelease`, or `null` → `fail`.
- Return `{ id: "version", title: "版本一致性", status, required: true, summary, evidence }` where evidence contains each sub-check's status and detail.

Register `checkVersion` as `checks.version` in `createRegistry()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: version tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/checks.ts tests/checks-version.test.ts
git commit -m "feat(checks): add version consistency check"
```

---

### Task 8: Required files and integrity checks

**Files:**
- Modify: `src/tools/checks.ts`, `src/tools/index.ts`
- Create: `tests/checks-files.test.ts`

**Interfaces:**
- Consumes: `RunContext`, `CheckResult`, `Manifest`.
- Produces: `checkRequiredFiles(ctx): Promise<CheckResult>`, `checkIntegrity(ctx): Promise<CheckResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/checks-files.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequiredFiles, checkIntegrity } from "../src/tools/checks.ts";

test("missing required file fails", async () => {
  const result = await checkRequiredFiles(await ctxFor("missing-file"));
  assert.equal(result.status, "fail");
  assert.match(result.summary, /LICENSE/);
});

test("bad hash fails integrity", async () => {
  const result = await checkIntegrity(await ctxFor("bad-hash"));
  assert.equal(result.status, "fail");
  assert.match(result.summary, /sha256/i);
});

test("manifest.json, directories, and OS junk are exempt from extra files", async () => {
  const ctx = await ctxFor("good");
  await writeFile(join(ctx.workspace!, ".DS_Store"), "");
  const result = await checkIntegrity(ctx);
  assert.equal(result.status, "pass");
});

test("an unlisted payload file fails integrity", async () => {
  const ctx = await ctxFor("good");
  await writeFile(join(ctx.workspace!, "extra.txt"), "x");
  const result = await checkIntegrity(ctx);
  assert.equal(result.status, "fail");
  assert.match(result.summary, /extra/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/checks-files.test.ts`
Expected: FAIL because the functions are not exported.

- [ ] **Step 3: Implement both checks**

`checkRequiredFiles`: for each `ctx.config.checks.requiredFiles`, check `existsSync(join(workspace, file))`; collect missing; status `fail` if any, else `pass`. Evidence lists present/missing.

`checkIntegrity`:

- Require `ctx.manifest`; missing → `fail`.
- For each `manifest.files`: reject duplicate paths; check exists, size, and `sha256`; collect mismatches.
- Compute actual files by walking `workspace` recursively (relative POSIX paths).
- Extra files = actual files minus manifest paths minus `manifest.json` minus OS junk (`**/.DS_Store`, `**/Thumbs.db`, `**/__MACOSX/**`) minus directories. If `allowExtraFiles` is false and extras exist → `fail`; if true → `warn` with extras listed.
- Status `fail` if any missing/hash/size/extra issue; else `pass`.

Both return `required: true`. Register them as `checks.required_files` and `checks.integrity` in `createRegistry()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: file/integrity tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/checks.ts tests/checks-files.test.ts
git commit -m "feat(checks): add required-file and integrity checks"
```

---

### Task 9: Forbidden files and changelog checks

**Files:**
- Modify: `src/tools/checks.ts`, `src/tools/index.ts`
- Create: `tests/checks-forbidden.test.ts`, `tests/checks-changelog.test.ts`

**Interfaces:**
- Produces: `checkForbidden(ctx): Promise<CheckResult>`, `checkChangelog(ctx): Promise<CheckResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/checks-forbidden.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkForbidden } from "../src/tools/checks.ts";

test("dotfiles match forbidden patterns", async () => {
  const result = await checkForbidden(await ctxFor("forbidden"));
  assert.equal(result.status, "fail");
  assert.match(result.summary, /\.env/);
});

test("content-scan hits are warnings by default and can be raised to fail", async () => {
  const ctx = await ctxFor("good");
  await writeFile(join(ctx.workspace!, "notes.txt"), "-----BEGIN PRIVATE KEY-----\n");
  ctx.config.checks.scanContent = true;
  assert.equal((await checkForbidden(ctx)).status, "warn");
  ctx.config.checks.contentScanSeverity = "fail";
  assert.equal((await checkForbidden(ctx)).status, "fail");
});
```

```ts
// tests/checks-changelog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkChangelog } from "../src/tools/checks.ts";

test("version heading passes, including CRLF", async () => {
  const ctx = await ctxFor("good");
  await writeFile(join(ctx.workspace!, "CHANGELOG.md"), "## [1.5.0]\r\n- fixed\r\n");
  assert.equal((await checkChangelog(ctx)).status, "pass");
});

test("missing version heading fails", async () => {
  const ctx = await ctxFor("good");
  await writeFile(join(ctx.workspace!, "CHANGELOG.md"), "## [1.4.0]\r\n");
  assert.equal((await checkChangelog(ctx)).status, "fail");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/checks-forbidden.test.ts tests/checks-changelog.test.ts`
Expected: FAIL because the functions are not exported.

- [ ] **Step 3: Implement both checks**

`checkForbidden`:

- Walk workspace files.
- Match each relative path with `minimatch(pattern, path, { dot: true, matchBase: true })` for every configured pattern; collect hits.
- If `scanContent`, read text files up to 1 MB and match `-----BEGIN [A-Z ]*PRIVATE KEY-----` and `AKIA[0-9A-Z]{16}`; collect content hits.
- Path hits → `fail`. Content hits → `ctx.config.checks.contentScanSeverity` (`warn` default, `fail` if configured).
- Status is the max severity; no hits → `pass`.

`checkChangelog`:

- Resolve `ctx.config.checks.changelogFile` under workspace; missing → `fail`.
- Read UTF-8, split on `\r?\n`.
- Find a line starting with `#` that includes `declaredVersion`; found → `pass`, else `fail`.
- Evidence includes the file and the matching line or the first 20 headings.

Register them as `checks.forbidden` and `checks.changelog` in `createRegistry()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: forbidden/changelog tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/checks.ts tests/checks-forbidden.test.ts tests/checks-changelog.test.ts
git commit -m "feat(checks): add forbidden-file and changelog checks"
```

---

### Task 10: Report writer, template, and fallback

**Files:**
- Create: `src/tools/report.ts`, `skills/minor-artifact-check/assets/report-template.md`, `tests/report.test.ts`
- Modify: `src/harness/report.ts`, `src/harness/loop.ts`, `src/harness/execute.ts`, `src/tools/index.ts`

**Interfaces:**
- Consumes: `buildReport` from Task 4, `CheckResult`.
- Produces: `writeReportTool`, `ensureReport(ctx, opts): Promise<Report>`, `renderMarkdown(report, template): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/report.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureReport } from "../src/tools/report.ts";

test("writes report.json and report.md", async () => {
  const ctx = await fullCtx("good");
  const report = await ensureReport(ctx);
  assert.equal(report.status, "pass");
  assert.equal(JSON.parse(await readFile(join(ctx.runDir, "report.json"), "utf8")).status, "pass");
  assert.match(await readFile(join(ctx.runDir, "report.md"), "utf8"), /1\.5\.0/);
});

test("missing template falls back to the built-in markdown", async () => {
  const ctx = await fullCtx("good");
  ctx.config.report.template = "missing.md";
  await assert.doesNotReject(() => ensureReport(ctx));
});

test("missing required checks produce a warn, incomplete report", async () => {
  const ctx = await baseCtx();
  const report = await ensureReport(ctx);
  assert.equal(report.status, "warn");
  assert.equal(report.incomplete, true);
});
```

`fullCtx` opens the artifact, reads the manifest, runs all five checks, and stores them in `ctx.checkResults`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/report.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the report writer and template**

`ensureReport(ctx, opts)`:

- If `ctx.reportWritten`, read and return `report.json`.
- `buildReport(ctx, opts)`.
- Write `report.json` (2-space indent).
- Render `report.md` from `ctx.config.report.template` if it exists; otherwise use a built-in template. Placeholders: `{{runId}}`, `{{status}}`, `{{artifact}}`, `{{declaredVersion}}`, `{{previousVersion}}`, `{{checksTable}}`, `{{evidence}}`, `{{generatedAt}}`.
- Set `ctx.reportWritten = true`.

`writeReportTool` (`report.write`) calls `ensureReport(ctx, { fallback: false })` and returns the paths. Register it as `report.write` in `createRegistry()`.

`runAgent` calls `ensureReport` before returning, so a model that never calls `report.write` still gets a report (`fallback: true`). Add a trace event `enforce`/`report` when the fallback is used.

Add `report.write` to the registry in `executeRun`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: report tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/report.ts src/harness/report.ts src/harness/loop.ts src/harness/execute.ts skills tests/report.test.ts
git commit -m "feat(report): write JSON and Markdown reports with fallback"
```

---

### Task 11: Skill loader, progressive disclosure, and skill tools

**Files:**
- Create: `src/skills/loader.ts`, `src/tools/skill.ts`, `skills/minor-artifact-check/SKILL.md`, `skills/minor-artifact-check/references/check-rules.md`, `skills/minor-artifact-check/assets/report-template.md`, `fixtures/plans/agent-full-check.json`, `fixtures/plans/agent-preloaded.json`, `tests/skills.test.ts`
- Modify: `src/harness/prompt.ts`, `src/harness/context.ts`, `src/harness/execute.ts`, `src/tools/index.ts`

**Interfaces:**
- Consumes: `SkillMeta`, `LoadedSkill`, `ToolDefinition`, `RunContext`.
- Produces: `parseSkillFile(path)`, `loadSkillCatalog(skillDirs)`, `loadSkill(name, skillDirs)`, `listSkillFiles(dir)`, `skillLoadTool`, `skillReadTool`; plan files for the default agent and preload modes.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/skills.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkillCatalog, loadSkill, parseSkillFile } from "../src/skills/loader.ts";
import { buildSystemPrompt } from "../src/harness/prompt.ts";
import { skillLoadTool, skillReadTool } from "../src/tools/skill.ts";

test("loads skill metadata and body", () => {
  const catalog = loadSkillCatalog(["skills"]);
  assert.equal(catalog[0].name, "minor-artifact-check");
  assert.ok(catalog[0].description.length > 0);
  assert.ok(loadSkill("minor-artifact-check", ["skills"]).body.includes("小版本制品检测流程"));
});

test("missing frontmatter or fields fail with a clear message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mah-skill-"));
  await writeFile(join(dir, "SKILL.md"), "---\ndescription: no name\n---\nbody");
  assert.throws(() => parseSkillFile(join(dir, "SKILL.md")), /name/);
});

test("auto mode prompt lists metadata but not the body; skill.load injects both", async () => {
  const ctx = await skillCtx({ selection: "auto" });
  assert.doesNotMatch(buildSystemPrompt(ctx), /小版本制品检测流程/);
  assert.match(buildSystemPrompt(ctx), /minor-artifact-check/);
  const loaded = await skillLoadTool.execute({ name: "minor-artifact-check" }, ctx);
  assert.equal(loaded.ok, true);
  assert.match(buildSystemPrompt(ctx), /小版本制品检测流程/);
});

test("skill.read blocks traversal outside the skill directory", async () => {
  const ctx = await skillCtx({ selection: "preload" });
  const result = await skillReadTool.execute({ name: "minor-artifact-check", path: "../../secret.txt" }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_traversal");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/skills.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the loader, tools, and prompt integration**

`parseSkillFile`:

- Read UTF-8. Require opening and closing `---`; parse YAML frontmatter.
- Validate `name` (string), `description` (string), `version` (number), `tools` (string[]).
- Body is the remaining Markdown.

`loadSkillCatalog` scans each `skillDirs` entry for `*/SKILL.md`, parses metadata only, and returns sorted `SkillMeta[]`. `loadSkill` returns the full `LoadedSkill` with `dir`, `body`, and `files` (all relative file paths under the skill dir, sorted).

`skillLoadTool`:

- Find the skill in the catalog; load it; store in `ctx.loadedSkills`.
- Add its `tools` to `ctx.activeToolNames`, intersected with `ctx.config.harness.toolAllowlist` when non-empty.
- Return metadata, body, and file index.

`skillReadTool`:

- Require the skill to be loaded.
- Resolve `join(skill.dir, path)`; reject absolute paths, `..`, and resolved paths outside `skill.dir` → `path_traversal`.
- Read up to 100 KB; return text.

`buildSystemPrompt`:

- In `auto`, list metadata only; include `skill.load` and `skill.read` in tools.
- After load, include the body and file index under `<active_skill>`.
- In `preload`, load `activeSkills` at context creation, include bodies and tools immediately.

`skills/minor-artifact-check/SKILL.md` uses the frontmatter and procedure from the spec. `references/check-rules.md` documents the five checks and severity rules. `assets/report-template.md` is the template used in Task 10.

`executeRun` registers `skill.load` and `skill.read` as meta tools. The CLI inspect path becomes fully usable after this task.

Default plans:

`fixtures/plans/agent-full-check.json`:

```json
[
  { "type": "tool_call", "tool": "skill.load", "args": { "name": "minor-artifact-check" } },
  { "type": "tool_call", "tool": "artifact.open", "args": { "source": "fixture", "fixture": "${fixture}" } },
  { "type": "tool_call", "tool": "artifact.manifest", "args": {} },
  { "type": "tool_call", "tool": "checks.version", "args": {} },
  { "type": "tool_call", "tool": "checks.required_files", "args": {} },
  { "type": "tool_call", "tool": "checks.integrity", "args": {} },
  { "type": "tool_call", "tool": "checks.forbidden", "args": {} },
  { "type": "tool_call", "tool": "checks.changelog", "args": {} },
  { "type": "tool_call", "tool": "report.write", "args": {} },
  { "type": "final", "content": "检测完成" }
]
```

`fixtures/plans/agent-preloaded.json` is the same without the `skill.load` step.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: skill tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/skills src/tools/skill.ts src/tools/index.ts src/harness/prompt.ts src/harness/context.ts src/harness/execute.ts skills fixtures/plans tests/skills.test.ts
git commit -m "feat(skills): add loader, progressive disclosure, and skill tools"
```

---

### Task 12: Fixed flow, required-check enforcement, and policy validation

**Files:**
- Create: `src/harness/flow.ts`, `src/config/policy.ts`, `fixtures/plans/agent-missing-required.json`, `fixtures/plans/agent-open-only.json`, `tests/flow.test.ts`, `tests/enforcement.test.ts`
- Modify: `src/harness/loop.ts`, `src/harness/execute.ts`

**Interfaces:**
- Produces: `runFixed(ctx): Promise<RunResult>`, `validatePolicy(config, toolNames: Set<string>): void`, `REQUIRED_CHECKS` enforcement in `runAgent`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/flow.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runFixed } from "../src/harness/flow.ts";
import { validatePolicy } from "../src/config/policy.ts";
import { defaultConfig } from "../src/config/schema.ts";

test("fixed flow runs stages in order and writes the same verdict as agent mode", async () => {
  const fixed = await runFixture("good", "fixed");
  const agent = await runFixture("good", "agent");
  assert.equal(fixed.report.status, "pass");
  assert.deepEqual(fixed.report.checks.map((c) => [c.id, c.status]), agent.report.checks.map((c) => [c.id, c.status]));
});

test("fixed flow rejects an unknown stage or a stage outside the allowlist", () => {
  assert.throws(() => validatePolicy({ ...defaultConfig, flow: { mode: "fixed", stages: [{ tool: "nope" }] } }, new Set(["artifact.open"])), /unknown tool/i);
  assert.throws(() => validatePolicy({ ...defaultConfig, harness: { ...defaultConfig.harness, toolAllowlist: ["artifact.open"] } }, new Set(["artifact.open", "checks.version"])), /allowlist/i);
});
```

```ts
// tests/enforcement.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { executeRun } from "../src/harness/execute.ts";
import { defaultConfig } from "../src/config/schema.ts";

test("agent final before required checks is rejected and the loop continues", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-missing-required.json";
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  const trace = await readFile(join(result.runDir, "trace.jsonl"), "utf8");
  assert.match(trace, /missing required checks/);
  assert.equal(result.report.checks.length, 5);
  assert.equal(result.status, "pass");
});

test("maxSteps auto-runs missing required checks", async () => {
  const config = structuredClone(defaultConfig);
  config.model.mock.planFile = "fixtures/plans/agent-open-only.json";
  config.harness.maxSteps = 2;
  const result = await executeRun({ inputs: baseInputs({ fixture: "good" }), config });
  assert.equal(result.status, "warn");
  assert.equal(result.report.incomplete, true);
  assert.deepEqual(
    result.report.checks.map((c) => c.id).sort(),
    ["changelog", "forbidden", "integrity", "required_files", "version"],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/flow.test.ts tests/enforcement.test.ts`
Expected: FAIL with module-not-found / missing exports.

- [ ] **Step 3: Implement flow, enforcement, and validation**

`validatePolicy(config, registeredToolNames)`:

- Every `flow.stages[].tool` exists in the registry; otherwise throw `unknown tool: <name>`.
- If `toolAllowlist` is non-empty, every stage and every required check tool is in it; otherwise throw `allowlist misses required tool: <name>`.
- In agent mode, the loaded skill's tools and the allowlist must cover all required checks; otherwise throw.
- `flow.stages` must include `report.write` and all five check tools when mode is fixed; otherwise throw.

`runFixed(ctx)`:

- Validate policy with the registry's names.
- Set `ctx.activeToolNames` to the stage tool names (so the same authorization path applies).
- Execute stages in order; trace each; on a failed tool, record the error and continue through the remaining checks, then write the report.
- `ensureReport`; return `RunResult`.

`runAgent` enforcement:

- Before accepting `final`, compute missing required checks from `ctx.checkResults`. If missing, append a `tool` message `missing required checks: ...` and continue; do not accept the final.
- On `maxSteps`, if `ctx.manifest` is null, run `artifact.manifest` first; then run missing required checks in `REQUIRED_CHECKS` order using the registry, trace `enforced`, then build the `warn`/`incomplete` report.
- If a required check tool is missing or denied, set `status: "error"` with `reason: "required_check_unavailable"`.

`runFixture(fixture, mode)` creates a temp run dir, clones `defaultConfig`, sets `model.mock.planFile` to `fixtures/plans/agent-full-check.json` for agent mode, calls `executeRun`, and returns the result. Fixed mode uses `flow.stages` and ignores the model plan.

`fixtures/plans/agent-missing-required.json`: `skill.load` → `artifact.open` → `artifact.manifest` → `checks.version` → `final` → `checks.required_files` → `checks.integrity` → `checks.forbidden` → `checks.changelog` → `report.write` → `final`. The first final is rejected; the second is accepted.

`fixtures/plans/agent-open-only.json`: `skill.load` → `artifact.open`. With `maxSteps: 2`, the harness auto-runs the manifest and the five checks.

`executeRun` chooses `runFixed` when `inputs.mode === "fixed"`, else `runAgent`. The server and CLI both use it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: flow/enforcement tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/harness/flow.ts src/harness/loop.ts src/config src/harness/execute.ts tests/flow.test.ts tests/enforcement.test.ts
git commit -m "feat(flow): add fixed mode, enforcement, and policy validation"
```

---

### Task 13: HTTP server, run history, and API

**Files:**
- Create: `src/server/server.ts`, `src/server/routes.ts`, `src/server/runStore.ts`, `tests/server.test.ts`
- Modify: `src/cli.ts` (`serve`)

**Interfaces:**
- Produces: `createServer({ config, cwd }): http.Server`, `startServer(config)`, `listRuns(runsDir, limit?)`, `readRun(runsDir, runId)`, `assertRunId(id)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server/server.ts";

test("POST /api/inspect runs a fixture and returns a report", async () => {
  const { server, baseUrl, close } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixture: "good", declaredVersion: "1.5.0", previousVersion: "1.4.2", mode: "agent" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "pass");
  assert.equal(body.report.checks.length, 5);
  assert.equal((await (await fetch(`${baseUrl}/api/runs`)).json()).runs.length, 1);
  await close();
});

test("invalid run ids and traversal are rejected", async () => {
  const { baseUrl, close } = await startTestServer();
  assert.equal((await fetch(`${baseUrl}/api/runs/..%2F..%2Fetc`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/runs/nope`)).status, 404);
  await close();
});
```

`startTestServer` is a local helper: create a temp dir for `report.outputDir`, clone `defaultConfig`, set `report.outputDir` to that dir and `model.mock.planFile` to the absolute repo path of `fixtures/plans/agent-full-check.json`, call `createServer` on port 0, and return `{ baseUrl, close }`. `GET /api/runs` returns `{ runs: [...] }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/server.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement server, routes, and run store**

`createServer` uses `node:http`. Routes:

- `GET /` and static files from `web/`; reject `..` and paths outside `web/`.
- `GET /api/config`: default config, skill catalog, tool descriptors.
- `POST /api/inspect`: JSON body limit 12 MB; validate `fixture` or `artifactBase64`; write uploads to a temp file; call `executeRun`; return `{ runId, status, report }`. On error, return 400 for input errors and 500 for harness errors with a readable message.
- `GET /api/runs`: `listRuns` over `config.report.outputDir`, newest first, default 20.
- `GET /api/runs/:id`: `readRun`; 400 for invalid id, 404 for missing.
- `GET /api/runs/:id/trace`: parsed JSONL array.
- `GET /api/runs/:id/report.json` / `report.md`: download.
- `GET /health`: `{ ok: true }`.

`runStore`:

```ts
export function assertRunId(id: string): void; // /^[A-Za-z0-9_-]+$/, else throw
export function listRuns(runsDir: string, limit?: number): RunSummary[];
export function readRun(runsDir: string, runId: string): { report: Report; trace: TraceEvent[] };
```

`listRuns` reads `runs/*/report.json`, ignores malformed dirs, sorts by `startedAt` descending. `readRun` asserts the id, resolves paths, and rejects paths outside `runsDir`.

`src/cli.ts serve` calls `startServer` and prints `http://127.0.0.1:<port>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: server tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server src/cli.ts tests/server.test.ts
git commit -m "feat(server): add inspect API and filesystem run history"
```

---

### Task 14: Form and trace viewer

**Files:**
- Create: `web/index.html`, `web/styles.css`, `web/app.js`
- Modify: `tests/server.test.ts` (static HTML smoke test)

**Interfaces:**
- Consumes: `/api/config`, `/api/inspect`, `/api/runs`, `/api/runs/:id`, `/api/runs/:id/trace`.
- Produces: a single-page form with IDs `inspect-form`, `artifact-file`, `fixture-select`, `declared-version`, `previous-version`, `mode`, `skill-selection`, `run-button`, `result-panel`, `status-badge`, `checks-table`, `trace-panel`, `runs-list`, `config-panel`.

- [ ] **Step 1: Write the failing static smoke test**

```ts
test("GET / serves the form", async () => {
  const { baseUrl, close } = await startTestServer();
  const html = await (await fetch(baseUrl)).text();
  assert.match(html, /id="inspect-form"/);
  assert.match(html, /id="trace-panel"/);
  await close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/server.test.ts`
Expected: FAIL because `web/index.html` is missing.

- [ ] **Step 3: Implement the form**

Layout: two columns on desktop, stacked on mobile. Left: artifact source (upload or fixture), versions, mode, skill selection, optional sub-items, run button. Right: status badge, summary, checks table, report links, trace timeline, recent runs. Bottom: collapsible config override panel.

`app.js`:

- Load `/api/config` and `/api/runs` on start.
- On submit, read the file as base64 if uploaded, POST JSON to `/api/inspect`, disable the button, show a running state.
- Render status, summary, checks with expandable evidence, report links, and a trace timeline.
- Load a run from `#runs-list` and render it.
- Show field-level errors and preserve the trace on harness errors.

`styles.css`: neutral light background, teal accent, green/amber/red status colors, monospace for versions/hashes, cards, responsive stacking. Use the design doc §7.4 as the contract; designer may refine visuals without changing IDs or behavior.

- [ ] **Step 4: Verify**

Run: `npm test && npm run dev`
Expected: tests pass; open `http://127.0.0.1:4317`; upload `fixtures/build/good.zip` and `fixtures/build/bad-hash.zip`; see pass/fail, evidence, trace, and history.

- [ ] **Step 5: Commit**

```bash
git add web tests/server.test.ts
git commit -m "feat(web): add inspection form and trace viewer"
```

---

### Task 15: GitHub remote, CI, PR practice, tag, and learning docs

**Files:**
- Create: `docs/learning/01-harness-loop.md`, `02-tools.md`, `03-skills.md`, `04-config-and-flow.md`, `05-form-and-report.md`, `docs/retrospective.md`
- Modify: `README.md`

**Interfaces:**
- Produces: public repo `lisy/minor-artifact-harness`, green CI, at least one merged PR, tag `v0.1.0`.

- [ ] **Step 1: Write the learning docs**

Each doc has five sections: 这一层解决什么问题；代码地图；一次运行发生了什么；小练习；检查问题。 Exercises:

- 01: change `maxSteps` to 1 and explain the report.
- 02: add a forbidden pattern and show the failing fixture.
- 03: edit `SKILL.md`'s step order and compare `prompt.md` and trace.
- 04: change `allowedBumps` to `[patch]` and explain the verdict.
- 05: run a bad artifact through the form and explain each failed check.

- [ ] **Step 2: Verify all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 3: Commit the learning docs**

```bash
git add docs README.md
git commit -m "docs: add learning guides and retrospective"
```

- [ ] **Step 4: Create the remote and push**

Create a public repository `lisy/minor-artifact-harness` in the OpenChamber Git panel or on GitHub. Add the remote:

```bash
git remote add origin https://github.com/lisy/minor-artifact-harness.git
git push -u origin main
```

If HTTPS asks for credentials, use the OpenChamber credential helper or a PAT. Do not commit tokens.

- [ ] **Step 5: Practice one PR**

```bash
git switch -c feat/final-polish
# make a small README change
git commit -am "docs: polish README"
git push -u origin feat/final-polish
```

Open a PR to `main`, wait for CI, merge it, then:

```bash
git switch main
git pull --ff-only
git tag v0.1.0
git push origin v0.1.0
```

- [ ] **Step 6: Verify**

Expected: remote shows the full history, CI is green, `v0.1.0` exists, and the README links the learning docs.

---

## Optional Follow-Up (not required for v0.1.0)

`src/models/openai-compat.ts` implements the same `ModelAdapter` using an OpenAI-compatible `/chat/completions` endpoint with native tool calling. It reads `baseUrl`, `apiKeyEnv`, `model`, and `temperature` from config; it never logs the key. Add a test with a local fake HTTP server. Do this only when a real endpoint is available.

## Execution Notes

- Run `npm test` after every task; the suite must stay green.
- Keep each commit focused; do not bundle unrelated tasks.
- If Node's native TS stripping rejects a syntax, replace that syntax; do not add a build step.
- If `zod` v4's API differs from the plan's usage, use `zod`'s current object/string APIs; the schema shapes stay the same.
- If `minimatch` needs `@types/minimatch`, install it; the matching behavior must use `{ dot: true, matchBase: true }`.
- All paths in reports and traces are relative; never write absolute paths or secrets.
