import { ToolRegistry } from "./registry.ts";
import { demoEchoTool } from "./demo.ts";
import { openArtifactTool, readManifestTool } from "./artifact.ts";
import {
  checkVersionTool,
  checkRequiredFilesTool,
  checkIntegrityTool,
  checkForbiddenTool,
  checkChangelogTool,
} from "./checks.ts";
import { writeReportTool } from "./report.ts";

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  registry.register(openArtifactTool);
  registry.register(readManifestTool);
  registry.register(checkVersionTool);
  registry.register(checkRequiredFilesTool);
  registry.register(checkIntegrityTool);
  registry.register(checkForbiddenTool);
  registry.register(checkChangelogTool);
  registry.register(writeReportTool);
  return registry;
}
