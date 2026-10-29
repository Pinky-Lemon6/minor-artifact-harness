import type { RunInputs } from "../src/harness/types.ts";

export function baseInputs(overrides: Partial<RunInputs> = {}): RunInputs {
  return {
    artifactSource: "fixture",
    fixture: "good",
    artifactFilename: "demo-app-1.5.0.zip",
    declaredVersion: "1.5.0",
    previousVersion: "1.4.2",
    mode: "agent",
    ...overrides,
  };
}
