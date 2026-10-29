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
  return registry;
}
