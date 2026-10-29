import { isAbsolute, resolve, sep } from "node:path";

/**
 * Resolve a relative path inside a root, rejecting anything that could leave it.
 * Used for manifest entries, required files, changelog paths, and fixtures.
 */
export function resolveInside(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes("\0") || relativePath.includes("\\")) {
    throw new Error(`invalid path: ${relativePath}`);
  }
  if (isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error(`absolute path: ${relativePath}`);
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => part === ".." || part === "" || part === ".")) {
    throw new Error(`path traversal: ${relativePath}`);
  }
  const rootResolved = resolve(root);
  const full = resolve(rootResolved, relativePath);
  if (full !== rootResolved && !full.startsWith(`${rootResolved}${sep}`)) {
    throw new Error(`path traversal: ${relativePath}`);
  }
  return full;
}
