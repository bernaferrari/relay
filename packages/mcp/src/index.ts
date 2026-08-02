#!/usr/bin/env tsx
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import { parseMcpConfig } from "./config.js";
import { createMcpServer, createRelayOperationInvoker } from "./server.js";

function diagnostic(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`relay-mcp: ${message}\n`);
}

export function runMcp(
  argv: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
) {
  const config = parseMcpConfig(argv, env);
  const invoker = createRelayOperationInvoker(config);
  return serveStdio(
    () =>
      createMcpServer({
        invoker,
        scope: { projectId: config.connection.projectId },
        profile: config.profile,
      }),
    { onerror: diagnostic },
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    runMcp();
  } catch (error) {
    diagnostic(error);
    process.exitCode = 1;
  }
}
