import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { RunContext, ToolDefinition, ToolResult } from "../harness/types.ts";
import { loadSkill } from "../skills/loader.ts";

export const skillLoadTool: ToolDefinition<{ name: string }> = {
  name: "skill.load",
  description: "Load a skill by name; returns its instructions, file index, and activates its tools.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Skill name from the available skills list" } },
    required: ["name"],
  },
  schema: z.object({ name: z.string() }),
  meta: true,
  execute: async (args, ctx: RunContext): Promise<ToolResult> => {
    let loaded;
    try {
      loaded = loadSkill(args.name, ctx.config.harness.skillDirs);
    } catch (error) {
      return {
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        error: { code: "skill_not_found", message: args.name },
      };
    }

    ctx.loadedSkills.set(loaded.name, loaded);
    const allowlist = ctx.config.harness.toolAllowlist;
    const activeTools: string[] = [];
    for (const tool of loaded.tools) {
      if (allowlist.length === 0 || allowlist.includes(tool)) {
        ctx.activeToolNames.add(tool);
        activeTools.push(tool);
      }
    }

    return {
      ok: true,
      summary: `loaded skill ${loaded.name} (${activeTools.length} tools)`,
      data: {
        name: loaded.name,
        description: loaded.description,
        version: loaded.version,
        body: loaded.body,
        files: loaded.files,
        activeTools,
      },
    };
  },
};

export const skillReadTool: ToolDefinition<{ name: string; path: string }> = {
  name: "skill.read",
  description: "Read a reference file or template bundled with a loaded skill.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Loaded skill name" },
      path: { type: "string", description: "Relative path inside the skill directory" },
    },
    required: ["name", "path"],
  },
  schema: z.object({ name: z.string(), path: z.string() }),
  meta: true,
  execute: async (args, ctx: RunContext): Promise<ToolResult> => {
    const skill = ctx.loadedSkills.get(args.name);
    if (!skill) {
      return {
        ok: false,
        summary: `skill not loaded: ${args.name}`,
        error: { code: "skill_not_loaded", message: args.name },
      };
    }

    if (isAbsolute(args.path) || args.path.includes("\\") || args.path.split("/").includes("..")) {
      return {
        ok: false,
        summary: `path traversal: ${args.path}`,
        error: { code: "path_traversal", message: args.path },
      };
    }

    const full = resolve(skill.dir, args.path);
    const rel = relative(skill.dir, full);
    if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
      return {
        ok: false,
        summary: `path traversal: ${args.path}`,
        error: { code: "path_traversal", message: args.path },
      };
    }

    if (!existsSync(full) || !statSync(full).isFile()) {
      return {
        ok: false,
        summary: `skill file not found: ${args.path}`,
        error: { code: "file_not_found", message: args.path },
      };
    }
    const realDir = realpathSync(skill.dir);
    const realFull = realpathSync(full);
    if (realFull !== realDir && !realFull.startsWith(`${realDir}${sep}`)) {
      return {
        ok: false,
        summary: `path traversal: ${args.path}`,
        error: { code: "path_traversal", message: args.path },
      };
    }
    if (statSync(full).size > 100 * 1024) {
      return {
        ok: false,
        summary: `skill file too large: ${args.path}`,
        error: { code: "file_too_large", message: args.path },
      };
    }

    return {
      ok: true,
      summary: `read ${args.name}/${args.path}`,
      data: { path: args.path, text: readFileSync(full, "utf8") },
    };
  },
};
