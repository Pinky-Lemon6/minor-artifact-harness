import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import type { LoadedSkill, SkillMeta } from "../harness/types.ts";

export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillError";
  }
}

function splitFrontmatter(text: string): { raw: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) {
    throw new SkillError("SKILL.md must start with a YAML frontmatter block");
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    throw new SkillError("SKILL.md frontmatter is not closed");
  }
  return {
    raw: normalized.slice(3, end).trim(),
    body: normalized.slice(end + 4).replace(/^\n/, ""),
  };
}

function validateMeta(raw: unknown): SkillMeta {
  if (!raw || typeof raw !== "object") throw new SkillError("SKILL.md frontmatter must be a mapping");
  const meta = raw as Record<string, unknown>;
  if (typeof meta.name !== "string" || !meta.name) throw new SkillError("skill name is required");
  if (typeof meta.description !== "string" || !meta.description) {
    throw new SkillError("skill description is required");
  }
  if (typeof meta.version !== "number") throw new SkillError("skill version must be a number");
  if (!Array.isArray(meta.tools) || !meta.tools.every((tool) => typeof tool === "string")) {
    throw new SkillError("skill tools must be an array of strings");
  }
  return {
    name: meta.name,
    description: meta.description,
    version: meta.version,
    tools: meta.tools as string[],
  };
}

export function parseSkillFile(path: string): SkillMeta & { body: string } {
  const text = readFileSync(path, "utf8");
  const { raw, body } = splitFrontmatter(text);
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new SkillError(
      `invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { ...validateMeta(parsed), body };
}

export function listSkillFiles(dir: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(relative(dir, full).split(sep).join("/"));
    }
  };
  visit(dir);
  return files.sort();
}

function skillDirsResolved(skillDirs: string[]): string[] {
  return skillDirs.map((dir) => resolve(process.cwd(), dir)).filter((dir) => existsSync(dir));
}

export function loadSkillCatalog(skillDirs: string[]): SkillMeta[] {
  const catalog: SkillMeta[] = [];
  for (const base of skillDirsResolved(skillDirs)) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(base, entry.name, "SKILL.md");
      if (!existsSync(path)) continue;
      const parsed = parseSkillFile(path);
      catalog.push({
        name: parsed.name,
        description: parsed.description,
        version: parsed.version,
        tools: parsed.tools,
      });
    }
  }
  return catalog.sort((left, right) => left.name.localeCompare(right.name));
}

export function loadSkill(name: string, skillDirs: string[]): LoadedSkill {
  for (const base of skillDirsResolved(skillDirs)) {
    const path = join(base, name, "SKILL.md");
    if (!existsSync(path)) continue;
    const parsed = parseSkillFile(path);
    const dir = dirname(path);
    return { ...parsed, dir, files: listSkillFiles(dir) };
  }
  throw new SkillError(`skill not found: ${name}`);
}
