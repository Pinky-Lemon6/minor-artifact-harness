import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { sha256 } from "../util/hash.ts";
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
    const fixture = args.fixture ?? ctx.inputs.fixture;
    let zipPath: string;

    if (source === "fixture") {
      if (!fixture) return error("missing_fixture", "fixture name is required");
      zipPath = join(process.cwd(), "fixtures/build", `${fixture}.zip`);
    } else {
      if (!ctx.inputs.uploadPath) return error("missing_upload", "uploadPath is required");
      zipPath = isAbsolute(ctx.inputs.uploadPath)
        ? ctx.inputs.uploadPath
        : resolve(process.cwd(), ctx.inputs.uploadPath);
    }

    if (!existsSync(zipPath)) return error("artifact_not_found", `artifact not found: ${zipPath}`);

    const bytes = readFileSync(zipPath);
    let entries;
    try {
      entries = await readZip(bytes, ZIP_LIMITS);
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : String(readError);
      return error("invalid_zip", message);
    }

    const workspace = join(ctx.runDir, "workspace");
    mkdirSync(workspace, { recursive: true });
    for (const entry of entries) {
      const target = join(workspace, entry.path);
      if (!target.startsWith(workspace)) {
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
