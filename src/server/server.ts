import { createServer as createHttpServer, type Server } from "node:http";
import type { HarnessConfig } from "../config/schema.ts";
import { handleRequest } from "./routes.ts";

export function createServer(opts: { config: HarnessConfig; cwd?: string }): Server {
  const cwd = opts.cwd ?? process.cwd();
  return createHttpServer((req, res) => {
    void handleRequest(req, res, { config: opts.config, cwd });
  });
}

export function startServer(config: HarnessConfig, cwd = process.cwd()): Server {
  if (config.server.host !== "127.0.0.1" && config.server.host !== "localhost") {
    throw new Error(`server.host must be loopback, got ${config.server.host}`);
  }
  const server = createServer({ config, cwd });
  server.listen(config.server.port, config.server.host);
  return server;
}
