import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { sha256 } from "../util/hash.ts";
import { resolveInside } from "../util/path.ts";
import { readZip } from "../util/zip.ts";
import type { Manifest, RunContext, ToolDefinition, ToolResult } from "../harness/types.ts";

const ZIP_LIMITS = { maxEntries: 2000, maxUncompressedBytes: 50 * 1024 * 1024 };

const openSchema = z.object({
  source: z.enum(["fixture", "upload"]).optional(),
  fixture: z.string().optional(),
});

const manifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      sha256: z.string(),
      size: z.number().int().nonnegative(),
    }),
  ),
  changelog: z.string().optional(),
});

function error(code: string, message: string): ToolResult {
  return { ok: false, summary: message, error: { code, message } };
}

export const openArtifactTool: ToolDefinition<{ source?: "fixture" | "upload"; fixture?: string }> = {
  name: "artifact.open",
  description: "Safely open and extract the artifact zip into this run's workspace.",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", enum: ["fixture", "upload"], description: "Where the zip comes from" },
      fixture: { type: "string", description: "Fixture name when source is fixture" },
    },
  },
  schema: openSchema,
  execute: async (args, ctx: RunContext): Promise<ToolResult> => {
    if (ctx.workspace) return error("workspace_already_open", "artifact is already open in this run");

    const source = args.source ?? ctx.inputs.artifactSource;
    if (source !== ctx.inputs.artifactSource) {
      return error("source_mismatch", `source ${source} does not match this run`);
    }

    let zipPath: string;
    if (source === "fixture") {
      const fixture = args.fixture ?? ctx.inputs.fixture;
      if (!fixture || fixture === "." || fixture === ".." || !/^[A-Za-z0-9_-]+$/.test(fixture)) {
        return error("invalid_fixture", `invalid fixture name: ${fixture ?? "(missing)"}`);
      }
      if (ctx.inputs.fixture && fixture !== ctx.inputs.fixture) {
        return error("fixture_mismatch", `fixture ${fixture} does not match this run`);
      }
      const buildRoot = resolve(process.cwd(), "fixtures/build");
      zipPath = resolve(buildRoot, `${fixture}.zip`);
      if (!zipPath.startsWith(`${buildRoot}${sep}`)) {
        return error("invalid_fixture", `fixture escapes fixtures/build: ${fixture}`);
      }
    } else {
      if (args.fixture) return error("fixture_not_allowed", "fixture is not allowed for an upload run");
      if (!ctx.inputs.uploadPath) return error("missing_upload", "uploadPath is required");
      zipPath = isAbsolute(ctx.inputs.uploadPath)
        ? ctx.inputs.uploadPath
        : resolve(process.cwd(), ctx.inputs.uploadPath);
    }

    if (!existsSync(zipPath)) return error("artifact_not_found", `artifact not found: ${zipPath}`);
    const zipStat = statSync(zipPath);
    if (!zipStat.isFile()) return error("artifact_not_file", `artifact is not a file: ${zipPath}`);
    if (zipStat.size > 10 * 1024 * 1024) {
      return error("artifact_too_large", `artifact exceeds 10 MB: ${zipStat.size}`);
    }

    const bytes = readFileSync(zipPath);
    let entries;
    try {
      entries = await readZip(bytes, ZIP_LIMITS);
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : String(readError);
      return error("invalid_zip", message);
    }

    const workspace = resolve(ctx.runDir, "workspace");
    mkdirSync(workspace, { recursive: true });
    for (const entry of entries) {
      let target: string;
      try {
        target = resolveInside(workspace, entry.path);
      } catch {
        return error("path_traversal", `entry escapes workspace: ${entry.path}`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.bytes);
    }

    ctx.workspace = workspace;
    ctx.artifact = {
      filename: ctx.inputs.artifactFilename,
      sha256: sha256(bytes),
      size: bytes.length,
    };

    return {
      ok: true,
      summary: `opened ${ctx.artifact.filename} (${entries.length} files)`,
      data: { files: entries.map((entry) => entry.path), ...ctx.artifact },
    };
  },
};

export const readManifestTool: ToolDefinition<Record<string, never>> = {
  name: "artifact.manifest",
  description: "Read and validate manifest.json from the opened artifact.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  execute: async (_args, ctx: RunContext): Promise<ToolResult> => {
    if (!ctx.workspace) return error("missing_workspace", "open the artifact before reading its manifest");
    const path = join(ctx.workspace, "manifest.json");
    if (!existsSync(path)) return error("missing_manifest", "manifest.json not found");

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (parseError) {
      return error(
        "invalid_manifest",
        parseError instanceof Error ? parseError.message : "manifest.json is not valid JSON",
      );
    }

    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) {
      return error("invalid_manifest", JSON.stringify(parsed.error.issues));
    }

    ctx.manifest = parsed.data as Manifest;
    return {
      ok: true,
      summary: `manifest ${ctx.manifest.name}@${ctx.manifest.version} (${ctx.manifest.files.length} files)`,
      data: ctx.manifest,
    };
  },
};
