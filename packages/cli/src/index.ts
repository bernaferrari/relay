#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import type { GlobalConfig, OutputMode } from "./config.js";
import { parseCli } from "./config.js";
import { classifyError, ExitCode } from "./errors.js";
import { renderHelp } from "./help.js";
import {
  createClient,
  invokeOperation,
  type ClientFactory,
  validateOperationId,
} from "./invoke.js";
import { CliOutput, type OutputStreams } from "./output.js";

export type CliDependencies = {
  env?: Record<string, string | undefined>;
  streams?: OutputStreams;
  createClient?: ClientFactory;
  registerSignalHandlers?: boolean;
};

const processStreams: OutputStreams = { stdout: process.stdout, stderr: process.stderr };

function fallbackMode(argv: readonly string[]): OutputMode {
  if (argv.includes("--ndjson")) return "ndjson";
  if (argv.includes("--json")) return "json";
  return "human";
}

function fallbackConfig(mode: OutputMode): GlobalConfig {
  return {
    connection: {
      url: "http://127.0.0.1:8787",
      organizationId: "local",
      projectId: "default",
      actorId: "human:local-cli",
      actorKind: "human",
      auth: { type: "none" },
    },
    credentialSource: { type: "none" },
    output: mode,
    quiet: false,
    timeoutMs: 20_000,
    wait: true,
  };
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const streams = dependencies.streams ?? processStreams;
  let output = new CliOutput(fallbackMode(argv), argv.includes("--quiet"), streams);
  let operationId: string | undefined;
  try {
    const parsed = parseCli(argv, dependencies.env ?? process.env);
    output = new CliOutput(parsed.config.output, parsed.config.quiet, streams);
    if (parsed.command === "help") {
      streams.stdout.write(renderHelp(parsed.helpFamily));
      return ExitCode.success;
    }
    operationId = parsed.operationId;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    if (dependencies.registerSignalHandlers !== false) {
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
    }
    try {
      output.progress(operationId, "invoking");
      validateOperationId(operationId);
      const client = (dependencies.createClient ?? createClient)(parsed.config);
      const result = await invokeOperation(client, operationId, parsed.input, abort.signal);
      output.result(operationId, result);
      return ExitCode.success;
    } finally {
      if (dependencies.registerSignalHandlers !== false) {
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
      }
    }
  } catch (error) {
    const classified = classifyError(error);
    output.error(classified, operationId);
    return classified.exitCode;
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) process.exitCode = await runCli(process.argv.slice(2));
