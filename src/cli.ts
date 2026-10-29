import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultConfig, type HarnessConfig } from "./config/schema.ts";
import { loadConfig } from "./config/load.ts";
import { executeRun } from "./harness/execute.ts";
import type { RunInputs, RunResult } from "./harness/types.ts";

function usage(): void {
  console.error("usage:");
  console.error("  node src/cli.ts demo");
  console.error("  node src/cli.ts inspect --fixture good --version 1.5.0 --previous 1.4.2 [--mode agent|fixed]");
  console.error("  node src/cli.ts inspect --zip path/to/artifact.zip --version 1.5.0 --previous 1.4.2");
  console.error("  node src/cli.ts serve [--port 4317]");
}

function statusExitCode(result: RunResult): number {
  if (result.status === "error") return 2;
  if (result.status === "pass") return 0;
  return 1;
}

function printResult(result: RunResult): void {
  console.log(`status: ${result.status}`);
  console.log(`final: ${result.final}`);
  for (const check of result.report.checks) {
    console.log(`  [${check.status}] ${check.title}: ${check.summary}`);
  }
  console.log(`report: ${result.runDir}/report.md`);
}

function demoConfig(): HarnessConfig {
  const config = structuredClone(defaultConfig);
  config.harness.activeSkills = [];
  config.model.mock.planFile = "fixtures/plans/demo.json";
  return config;
}

function demoInputs(): RunInputs {
  return {
    artifactSource: "fixture",
    fixture: "good",
    artifactFilename: "demo-app-1.5.0.zip",
    declaredVersion: "1.5.0",
    previousVersion: "1.4.2",
    mode: "agent",
  };
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      fixture: { type: "string" },
      zip: { type: "string" },
      version: { type: "string" },
      previous: { type: "string" },
      mode: { type: "string" },
      port: { type: "string" },
    },
  });

  const command = positionals[0];
  const cwd = process.cwd();

  if (command === "demo") {
    const result = await executeRun({ inputs: demoInputs(), config: demoConfig(), cwd });
    console.log(result.final);
    console.log(`run: ${result.runDir}`);
    return result.status === "error" ? 2 : 0;
  }

  if (command === "inspect") {
    if (!values.version || !values.previous) {
      console.error("inspect requires --version and --previous");
      usage();
      return 2;
    }
    if (!values.fixture && !values.zip) {
      console.error("inspect requires --fixture or --zip");
      usage();
      return 2;
    }
    const inputs: RunInputs = {
      artifactSource: values.zip ? "upload" : "fixture",
      fixture: values.fixture,
      uploadPath: values.zip ? resolve(cwd, values.zip) : undefined,
      artifactFilename: values.zip ? basename(values.zip) : `${values.fixture}.zip`,
      declaredVersion: values.version,
      previousVersion: values.previous,
      mode: values.mode === "fixed" ? "fixed" : "agent",
    };
    const result = await executeRun({ inputs, config: loadConfig({ cwd }), cwd });
    printResult(result);
    return statusExitCode(result);
  }

  if (command === "serve") {
    console.log("the HTTP server arrives in Task 13; run `npm run dev` after that task");
    return 0;
  }

  usage();
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
