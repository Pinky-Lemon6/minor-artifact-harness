import { zipSync } from "fflate";
import yauzl from "yauzl";

export type ZipEntry = { path: string; bytes: Uint8Array };
export type ZipLimits = { maxEntries: number; maxUncompressedBytes: number };

export function writeZip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries);
}

function assertSafePath(name: string): string {
  if (name.includes("\0")) throw new Error(`invalid path: ${name}`);
  if (name.startsWith("/")) throw new Error(`absolute path: ${name}`);
  if (/^[A-Za-z]:/.test(name)) throw new Error(`absolute path: ${name}`);
  if (name.includes("\\")) throw new Error(`invalid path: ${name}`);
  const parts = name.split("/");
  if (parts.some((part) => part === "..")) throw new Error(`path traversal: ${name}`);
  if (parts.some((part) => part === "" || part === ".")) throw new Error(`invalid path: ${name}`);
  return parts.join("/");
}

export function readZip(bytes: Uint8Array, limits: ZipLimits): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(openError ?? new Error("invalid zip"));
        return;
      }

      const entries: ZipEntry[] = [];
      const seen = new Set<string>();
      let total = 0;
      let settled = false;

      const normalize = (error: Error): Error =>
        /invalid relative path/i.test(error.message)
          ? new Error(`path traversal: ${error.message}`)
          : error;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        zipfile.close();
        reject(normalize(error));
      };

      zipfile.on("error", fail);
      zipfile.on("entry", (entry: yauzl.Entry) => {
        if (settled) return;
        if (entry.fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }

        let normalized: string;
        try {
          normalized = assertSafePath(entry.fileName);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) {
          fail(new Error(`symlink entry: ${entry.fileName}`));
          return;
        }

        if (seen.has(normalized)) {
          fail(new Error(`duplicate path: ${entry.fileName}`));
          return;
        }
        seen.add(normalized);

        if (entries.length + 1 > limits.maxEntries) {
          fail(new Error(`too many entries: ${entry.fileName}`));
          return;
        }
        total += entry.uncompressedSize;
        if (total > limits.maxUncompressedBytes) {
          fail(new Error(`uncompressed size too large: ${total}`));
          return;
        }

        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error(`cannot read entry: ${entry.fileName}`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", fail);
          stream.on("end", () => {
            entries.push({ path: normalized, bytes: new Uint8Array(Buffer.concat(chunks)) });
            zipfile.readEntry();
          });
        });
      });

      zipfile.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(entries.sort((left, right) => left.path.localeCompare(right.path)));
      });

      zipfile.readEntry();
    });
  });
}
