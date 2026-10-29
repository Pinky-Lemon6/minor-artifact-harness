import { REQUIRED_CHECKS } from "../harness/types.ts";
import { loadSkill } from "../skills/loader.ts";
import type { HarnessConfig } from "./schema.ts";

const CHECK_TOOLS = REQUIRED_CHECKS.map((id) => `checks.${id}`);
const REQUIRED_TOOLS = [...CHECK_TOOLS, "report.write"];
const FIXED_REQUIRED_TOOLS = ["artifact.open", "artifact.manifest", ...REQUIRED_TOOLS];

export function validatePolicy(config: HarnessConfig, registeredToolNames: Set<string>): void {
  for (const stage of config.flow.stages) {
    if (!registeredToolNames.has(stage.tool)) {
      throw new Error(`unknown tool: ${stage.tool}`);
    }
  }

  const allowlist = config.harness.toolAllowlist;
  if (allowlist.length > 0) {
    for (const stage of config.flow.stages) {
      if (!allowlist.includes(stage.tool)) {
        throw new Error(`allowlist misses required tool: ${stage.tool}`);
      }
    }
    for (const tool of REQUIRED_TOOLS) {
      if (!allowlist.includes(tool)) {
        throw new Error(`allowlist misses required tool: ${tool}`);
      }
    }
  }

  if (config.flow.mode === "fixed") {
    const stageTools = new Set(config.flow.stages.map((stage) => stage.tool));
    for (const tool of FIXED_REQUIRED_TOOLS) {
      if (!stageTools.has(tool)) {
        throw new Error(`fixed flow missing required tool: ${tool}`);
      }
    }
    return;
  }

  if (config.harness.activeSkills.length > 0) {
    const skillTools = new Set<string>();
    for (const name of config.harness.activeSkills) {
      const skill = loadSkill(name, config.harness.skillDirs);
      for (const tool of skill.tools) skillTools.add(tool);
    }
    for (const tool of ["artifact.open", "artifact.manifest", ...REQUIRED_TOOLS]) {
      if (!skillTools.has(tool)) {
        throw new Error(`skill misses required tool: ${tool}`);
      }
    }
    if (allowlist.length > 0) {
      for (const tool of ["skill.load", "skill.read", "artifact.open", "artifact.manifest", ...REQUIRED_TOOLS]) {
        if (!allowlist.includes(tool)) {
          throw new Error(`allowlist misses required tool: ${tool}`);
        }
      }
    }
  }
}
