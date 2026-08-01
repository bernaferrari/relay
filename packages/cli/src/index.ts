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
  type OperationInvoker,
  validateOperationId,
} from "./invoke.js";
import { CliOutput, type OutputStreams } from "./output.js";

export type CliDependencies = {
  env?: Record<string, string | undefined>;
  streams?: OutputStreams;
  createClient?: ClientFactory;
  registerSignalHandlers?: boolean;
  pollIntervalMs?: number;
};

const processStreams: OutputStreams = { stdout: process.stdout, stderr: process.stderr };
const jobStatuses = new Set(["queued", "running", "paused", "ok", "error", "healed", "cancelled"]);
const terminalJobStatuses = new Set(["ok", "error", "healed", "cancelled"]);

function abortError(): DOMException {
  return new DOMException("cancelled", "AbortError");
}

function waitForPoll(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, intervalMs);
    signal.addEventListener("abort", cancel, { once: true });

    function finish(): void {
      signal.removeEventListener("abort", cancel);
      resolve();
    }

    function cancel(): void {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

function jobStatus(response: unknown): string {
  if (
    !response ||
    typeof response !== "object" ||
    !("job" in response) ||
    !response.job ||
    typeof response.job !== "object" ||
    !("status" in response.job) ||
    typeof response.job.status !== "string"
  ) {
    throw new Error("Malformed job.get response: expected { job: { status: string } }");
  }
  if (!jobStatuses.has(response.job.status)) {
    throw new Error(`Malformed job.get response: unknown job status ${response.job.status}`);
  }
  return response.job.status;
}

async function watchJob(
  client: OperationInvoker,
  operationId: string,
  input: unknown,
  signal: AbortSignal,
  output: CliOutput,
  pollIntervalMs: number,
): Promise<unknown> {
  output.progress(operationId, "watching");
  while (true) {
    const result = await invokeOperation(client, operationId, input, signal);
    if (signal.aborted) throw abortError();
    const status = jobStatus(result);
    output.snapshot(operationId, result);
    if (terminalJobStatuses.has(status)) return result;
    await waitForPoll(pollIntervalMs, signal);
  }
}

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
      validateOperationId(operationId);
      const client = (dependencies.createClient ?? createClient)(parsed.config);
      if (parsed.commandPath === "system events follow") {
        output.progress(operationId, "following");
        await client.events((event) => output.event(event), { signal: abort.signal });
        if (abort.signal.aborted) throw abortError();
        output.result(operationId, {});
      } else if (parsed.commandPath === "job watch" && parsed.config.wait) {
        const result = await watchJob(
          client,
          operationId,
          parsed.input,
          abort.signal,
          output,
          dependencies.pollIntervalMs ?? 250,
        );
        output.result(operationId, result);
      } else {
        output.progress(operationId, "invoking");
        const result = await invokeOperation(client, operationId, parsed.input, abort.signal);
        output.result(operationId, result);
      }
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
