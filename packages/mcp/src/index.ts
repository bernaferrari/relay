#!/usr/bin/env tsx
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMcpConfig } from "./config.js";
import { runRelayMcpDoctorCommand } from "./doctor.js";
import { createMcpServer, createRelayOperationInvoker } from "./server.js";

function diagnostic(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`relay-mcp: ${message}\n`);
}

export function runMcp(
  argv: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
) {
  if (argv[0] === "doctor") {
    return runRelayMcpDoctorCommand(argv.slice(1), env).then((exitCode) => {
      process.exitCode = exitCode;
    });
  }
  const config = parseMcpConfig(argv, env);
  const invoker = createRelayOperationInvoker(config);
  return serveStdio(
    () =>
      createMcpServer({
        invoker,
        scope: { projectId: config.connection.projectId },
        profile: config.profile,
        actorId: config.connection.actorId,
      }),
    { onerror: diagnostic },
  );
}

const isEntryPoint =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  Promise.resolve()
    .then(async () => {
      await runMcp();
    })
    .catch((error: unknown) => {
      diagnostic(error);
      process.exitCode = 1;
    });
}
