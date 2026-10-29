import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSkillCatalog } from "../skills/loader.ts";
import type { RunContext } from "./types.ts";

export function buildSystemPrompt(ctx: RunContext): string {
  const tools = ctx.registry.descriptors(ctx.activeToolNames);
  const toolLines = tools.length
    ? tools
        .map(
          (tool) =>
            `- ${tool.name}: ${tool.description}\n  parameters: ${JSON.stringify(tool.parameters)}`,
        )
        .join("\n")
    : "(none yet)";

  const catalog = loadSkillCatalog(ctx.config.harness.skillDirs).filter(
    (skill) =>
      ctx.config.harness.activeSkills.length === 0 ||
      ctx.config.harness.activeSkills.includes(skill.name),
  );
  const availableSkills = catalog.length
    ? catalog.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
    : "(none)";

  const activeSkills = [...ctx.loadedSkills.values()]
    .map(
      (skill) =>
        `<active_skill name="${skill.name}">\n${skill.body}\n\nfiles:\n${skill.files
          .map((file) => `- ${file}`)
          .join("\n")}\n</active_skill>`,
    )
    .join("\n\n");

  return [
    "You are minor-artifact-harness, a small agent harness for inspecting minor-release artifacts.",
    `Run mode: ${ctx.inputs.mode}.`,
    "Work only through the tools listed below. Never invent a tool name.",
    "Use the policy from the harness configuration; do not try to loosen it.",
    "",
    "## Available skills",
    availableSkills,
    "",
    "## Active skill",
    activeSkills || "(none loaded yet; call skill.load when a skill applies)",
    "",
    "## Tools",
    toolLines,
    "",
    "## Output protocol",
    "Return exactly one JSON object per turn, with no markdown fences.",
    'Tool call: {"type":"tool_call","tool":"<name>","args":{...},"thought":"..."}',
    'Final answer: {"type":"final","content":"..."}',
  ].join("\n");
}

export function buildUserPrompt(ctx: RunContext): string {
  return [
    "Inspect this artifact and report the result.",
    `artifact: ${ctx.inputs.artifactFilename}`,
    `declaredVersion: ${ctx.inputs.declaredVersion}`,
    `previousVersion: ${ctx.inputs.previousVersion}`,
    `mode: ${ctx.inputs.mode}`,
  ].join("\n");
}

export function writePrompt(runDir: string, system: string, user: string): void {
  writeFileSync(join(runDir, "prompt.md"), `# System\n\n${system}\n\n# User\n\n${user}\n`, "utf8");
}
