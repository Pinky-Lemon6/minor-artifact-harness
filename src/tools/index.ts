import { ToolRegistry } from "./registry.ts";
import { demoEchoTool } from "./demo.ts";
import { openArtifactTool, readManifestTool } from "./artifact.ts";
import { checkVersionTool, checkRequiredFilesTool, checkIntegrityTool } from "./checks.ts";

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  registry.register(openArtifactTool);
  registry.register(readManifestTool);
  registry.register(checkVersionTool);
  registry.register(checkRequiredFilesTool);
  registry.register(checkIntegrityTool);
  return registry;
}
