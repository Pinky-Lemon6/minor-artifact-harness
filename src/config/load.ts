import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  ConfigError,
  defaultConfig,
  mergeConfig,
  validateConfig,
  type ConfigOverride,
  type HarnessConfig,
} from "./schema.ts";

const SECTIONS = new Set(Object.keys(defaultConfig));

export function loadConfig(opts: { cwd?: string; overrides?: ConfigOverride } = {}): HarnessConfig {
  const cwd = opts.cwd ?? process.cwd();
  let config = defaultConfig;

  for (const relative of ["config/default.yaml", "config/local.yaml"]) {
    const path = join(cwd, relative);
    if (!existsSync(path)) continue;
    const raw = parse(readFileSync(path, "utf8")) ?? {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new ConfigError(`${relative}: expected a mapping at the top level`);
    }
    for (const key of Object.keys(raw)) {
      if (!SECTIONS.has(key)) {
        throw new ConfigError(`${relative}: unknown config section "${key}"`);
      }
    }
    config = mergeConfig(config, raw as ConfigOverride);
  }

  if (opts.overrides) config = mergeConfig(config, opts.overrides);
  return validateConfig(config);
}
