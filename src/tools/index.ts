import { ToolRegistry } from "./registry.ts";
import { demoEchoTool } from "./demo.ts";
import { openArtifactTool, readManifestTool } from "./artifact.ts";

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(demoEchoTool);
  registry.register(openArtifactTool);
  registry.register(readManifestTool);
  return registry;
}
