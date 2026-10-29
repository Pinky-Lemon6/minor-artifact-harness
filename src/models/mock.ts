import { readFileSync } from "node:fs";
import type { ChatMessage, ModelAdapter, ModelResponse, RunInputs } from "../harness/types.ts";

export type MockPlanStep =
  | { type: "tool_call"; tool: string; args?: unknown; expect?: { contains?: string } }
  | { type: "final"; content: string };

export class MockPlanExhaustedError extends Error {
  constructor() {
    super("mock plan exhausted");
    this.name = "MockPlanExhaustedError";
  }
}

export class MockPlanAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockPlanAssertionError";
  }
}

function replaceDeep(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceDeep(item, values));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceDeep(item, values)]),
    );
  }
  return value;
}

export function loadMockPlan(path: string, inputs: RunInputs): MockPlanStep[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const values: Record<string, string> = {
    declaredVersion: inputs.declaredVersion,
    previousVersion: inputs.previousVersion,
    fixture: inputs.fixture ?? "",
    artifactFilename: inputs.artifactFilename,
  };
  return replaceDeep(raw, values) as MockPlanStep[];
}

function lastMessageText(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1];
  return last && "content" in last ? last.content : "";
}

export class MockModel implements ModelAdapter {
  readonly name = "mock";
  private readonly plan: MockPlanStep[];
  private index = 0;

  constructor(plan: MockPlanStep[]) {
    this.plan = plan;
  }

  async complete(input: { messages: ChatMessage[] }): Promise<ModelResponse> {
    const step = this.plan[this.index];
    if (!step) throw new MockPlanExhaustedError();

    if (step.type === "tool_call" && step.expect?.contains) {
      const text = lastMessageText(input.messages);
      if (!text.includes(step.expect.contains)) {
        throw new MockPlanAssertionError(
          `expected last observation to contain ${JSON.stringify(step.expect.contains)}`,
        );
      }
    }

    this.index += 1;
    if (step.type === "final") {
      return { type: "final", content: step.content };
    }
    return { type: "tool_call", tool: step.tool, args: step.args ?? {} };
  }
}
