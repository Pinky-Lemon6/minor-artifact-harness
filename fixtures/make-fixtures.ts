import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../src/util/hash.ts";
import { writeZip } from "../src/util/zip.ts";

const VERSION = "1.5.0";
const encoder = new TextEncoder();
const encode = (text: string): Uint8Array => encoder.encode(text);

export type FixtureName = "good" | "bad-version" | "bad-hash" | "forbidden" | "missing-file";
export const FIXTURE_NAMES: FixtureName[] = [
  "good",
  "bad-version",
  "bad-hash",
  "forbidden",
  "missing-file",
];

function baseFiles(): Record<string, Uint8Array> {
  return {
    "README.md": encode("# demo-app\n\nA fixture for the harness.\n"),
    LICENSE: encode("MIT License\n"),
    "CHANGELOG.md": encode("## [1.5.0]\n\n- initial release\n"),
    "package.json": encode(JSON.stringify({ name: "demo-app", version: VERSION }, null, 2)),
    "dist/app.js": encode("console.log('demo');\n"),
  };
}

function manifestBytes(files: Record<string, Uint8Array>, version = VERSION): Uint8Array {
  const entries = Object.entries(files)
    .map(([path, bytes]) => ({ path, sha256: sha256(bytes), size: bytes.length }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return encode(
    JSON.stringify(
      { name: "demo-app", version, files: entries, changelog: "CHANGELOG.md" },
      null,
      2,
    ),
  );
}

function withManifest(
  files: Record<string, Uint8Array>,
  version = VERSION,
): Record<string, Uint8Array> {
  return { ...files, "manifest.json": manifestBytes(files, version) };
}

function badHashFiles(): Record<string, Uint8Array> {
  const files = withManifest(baseFiles());
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as {
    files: { path: string; sha256: string; size: number }[];
  };
  for (const entry of manifest.files) {
    if (entry.path === "dist/app.js") entry.sha256 = "0".repeat(64);
  }
  files["manifest.json"] = encode(JSON.stringify(manifest, null, 2));
  return files;
}

export function buildFixture(name: FixtureName): Uint8Array {
  switch (name) {
    case "good":
      return writeZip(withManifest(baseFiles()));
    case "bad-version":
      return writeZip(withManifest(baseFiles(), "1.4.0"));
    case "bad-hash":
      return writeZip(badHashFiles());
    case "forbidden": {
      const files = baseFiles();
      files[".env"] = encode("SECRET=fixture\n");
      files["config/prod.key"] = encode("not-a-real-key\n");
      return writeZip(withManifest(files));
    }
    case "missing-file": {
      const files = withManifest(baseFiles());
      delete files.LICENSE;
      return writeZip(files);
    }
  }
}

export function ensureFixtures(cwd = process.cwd()): string {
  const dir = join(cwd, "fixtures/build");
  mkdirSync(dir, { recursive: true });
  for (const name of FIXTURE_NAMES) {
    const path = join(dir, `${name}.zip`);
    if (!existsSync(path)) writeFileSync(path, buildFixture(name));
  }
  return dir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = ensureFixtures();
  console.log(`fixtures: ${dir}`);
}
