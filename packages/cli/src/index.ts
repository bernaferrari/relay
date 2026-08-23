#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import {
  summarizeAppMapOperationResult,
  summarizeAuthoringOperationResult,
  summarizeExecutionOperationResult,
  summarizeTargetOperationResult,
  wantsFullSnapshotTree,
} from "@relay/protocol";
import type { OutputMode } from "./config.js";
import { parseCli } from "./config.js";
import { classifyError, CliError, ExitCode, UsageError } from "./errors.js";
import { renderHelp } from "./help.js";
import {
  createClient,
  invokeOperation,
  readResource,
  type ClientFactory,
  type OperationInvoker,
  validateOperationId,
} from "./invoke.js";
import { CliOutput, type OutputStreams } from "./output.js";
import { emitScreenshot, emitSnapshotFile } from "./screenshot.js";
import { persistScrollSurvey } from "./survey-persist.js";
import { runDbCommand } from "./db-commands.js";
import { runPackCommand } from "./pack-check.js";

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
  let lastHeartbeat = "";
  while (true) {
    const result = await invokeOperation(client, operationId, input, signal);
    if (signal.aborted) throw abortError();
    const status = jobStatus(result);
    output.snapshot(operationId, summarizeExecutionOperationResult(operationId, result));
    if (terminalJobStatuses.has(status)) return result;
    const job =
      result && typeof result === "object" && "job" in result
        ? (result as { job?: { logs?: unknown; lastLogs?: unknown } }).job
        : undefined;
    const rawLogs = Array.isArray(job?.logs)
      ? job.logs
      : Array.isArray(job?.lastLogs)
        ? job.lastLogs
        : [];
    const logs = rawLogs.filter((item): item is string => typeof item === "string");
    const last = logs.at(-1);
    if (last && last !== lastHeartbeat) {
      lastHeartbeat = last;
      output.heartbeat(last.length > 120 ? `${last.slice(0, 117)}…` : last);
    }
    await waitForPoll(pollIntervalMs, signal);
  }
}

function startedJobIds(response: unknown): string[] {
  if (!response || typeof response !== "object") {
    throw new Error("Malformed execution response: expected one or more jobs");
  }
  const ids: string[] = [];
  const direct = "job" in response ? response.job : undefined;
  if (direct && typeof direct === "object" && "id" in direct && typeof direct.id === "string") {
    ids.push(direct.id);
  }
  const jobs = "jobs" in response && Array.isArray(response.jobs) ? response.jobs : [];
  for (const job of jobs) {
    if (!job || typeof job !== "object" || !("id" in job) || typeof job.id !== "string") {
      throw new Error("Malformed execution response: every started job needs an id");
    }
    ids.push(job.id);
  }
  const unique = [...new Set(ids)];
  if (unique.length) return unique;
  throw new Error("Malformed execution response: expected one or more jobs");
}

function summarizeResult(
  operationId: string,
  result: unknown,
  input?: unknown,
  commandPath?: string,
): unknown {
  const inner = summarizeExecutionOperationResult(
    operationId,
    summarizeAppMapOperationResult(
      operationId,
      summarizeAuthoringOperationResult(operationId, result),
      { commandPath, input },
    ),
  );
  if (operationId === "target.snapshot.capture" && wantsFullSnapshotTree(input)) return inner;
  return summarizeTargetOperationResult(operationId, inner);
}

function failureMessage(value: unknown, fallback: string): string {
  const bound = (message: string): string =>
    message.length <= 4_000 ? message : `${message.slice(0, 3_999)}…`;
  if (typeof value === "string" && value.trim()) return bound(value.trim());
  if (value && typeof value === "object" && "message" in value) {
    const message = value.message;
    if (typeof message === "string" && message.trim()) return bound(message.trim());
  }
  return fallback;
}

/** Transport success is not operation success. Keep shell scripts and agents
 * from treating a structured `{ ok: false }` result or failed job as a pass. */
function assertOperationSucceeded(
  operationId: string,
  result: unknown,
  input?: unknown,
  commandPath?: string,
): void {
  if (!result || typeof result !== "object") return;
  if ("ok" in result && result.ok === false) {
    const error = "error" in result ? result.error : undefined;
    throw new CliError(
      failureMessage(error, `${operationId} did not complete successfully`),
      ExitCode.validation,
      summarizeResult(operationId, result, input, commandPath),
    );
  }
  if ("job" in result && result.job && typeof result.job === "object" && "status" in result.job) {
    const status = result.job.status;
    if (status === "cancelled") {
      throw new CliError(
        "Operation cancelled",
        ExitCode.cancellation,
        summarizeResult(operationId, result, input),
      );
    }
    if (status === "error") {
      const error = "error" in result.job ? result.job.error : undefined;
      throw new CliError(
        failureMessage(error, `${operationId} failed`),
        ExitCode.validation,
        summarizeResult(operationId, result, input),
      );
    }
  }
}

function fallbackMode(argv: readonly string[]): OutputMode {
  if (argv.includes("--ndjson")) return "ndjson";
  if (argv.includes("--json")) return "json";
  return "human";
}

function firstPositional(argv: readonly string[]): string | undefined {
  for (const token of argv) {
    if (!token.startsWith("-") || token === "-") return token;
  }
  return undefined;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError(`Malformed ${label} response`);
  }
  return value as Record<string, unknown>;
}

async function resolveCurrentTestRunInput(
  client: OperationInvoker,
  parsed: Extract<ReturnType<typeof parseCli>, { command: "invoke" }>,
  signal: AbortSignal,
  output: CliOutput,
): Promise<Record<string, unknown>> {
  if (!parsed.currentTarget && !parsed.currentRevision) return parsed.input;
  const appMapId = parsed.input.appMapId;
  if (typeof appMapId !== "string" || !appMapId) {
    throw new UsageError("test run shortcuts require an App Map id");
  }
  const next = { ...parsed.input };
  if (parsed.currentRevision) {
    const response = object(
      await invokeOperation(client, "app-map.get", { appMapId }, signal),
      "app-map.get",
    );
    const appMap = object(response.appMap, "app-map.get appMap");
    if (typeof appMap.revision !== "number") {
      throw new UsageError("The current App Map has no numeric revision");
    }
    next.expectedRevision = appMap.revision;
  }
  if (parsed.currentTarget) {
    const response = object(
      await invokeOperation(client, "target.devices.list", {}, signal),
      "target.devices.list",
    );
    const devices = Array.isArray(response.devices)
      ? response.devices.filter((value) => value && typeof value === "object")
      : [];
    if (devices.length !== 1) {
      throw new UsageError(
        devices.length
          ? `--target current is ambiguous: ${devices.length} targets are connected`
          : "--target current found no connected target",
      );
    }
    const device = object(devices[0], "connected target");
    const targetId =
      typeof device.serial === "string"
        ? device.serial
        : typeof device.id === "string"
          ? device.id
          : undefined;
    if (!targetId || (device.platform !== "android" && device.platform !== "ios")) {
      throw new UsageError("The connected target is not a runnable Android or iOS device");
    }
    next.target = { kind: "device", platform: device.platform, targetId };
  }
  const target = next.target && typeof next.target === "object" ? next.target : undefined;
  const targetId = target && "targetId" in target ? String(target.targetId) : "explicit target";
  output.heartbeat(`Resolved Test run revision ${next.expectedRevision} on ${targetId}`);
  return next;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const streams = dependencies.streams ?? processStreams;
  let output = new CliOutput(fallbackMode(argv), argv.includes("--quiet"), streams);
  let operationId: string | undefined;
  try {
    if (firstPositional(argv) === "db") {
      return await runDbCommand(argv, streams, dependencies.env ?? process.env);
    }
    if (firstPositional(argv) === "pack") {
      return await runPackCommand(
        argv,
        streams,
        dependencies.env?.INIT_CWD?.trim() || process.cwd(),
      );
    }
    const parsed = parseCli(argv, dependencies.env ?? process.env);
    output = new CliOutput(parsed.config.output, parsed.config.quiet, streams);
    if (parsed.command === "help") {
      streams.stdout.write(renderHelp(parsed.helpFamily));
      return ExitCode.success;
    }
    operationId = parsed.command === "invoke" ? parsed.operationId : parsed.resourceId;
    const commandPath = "commandPath" in parsed ? parsed.commandPath : undefined;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    if (dependencies.registerSignalHandlers !== false) {
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
    }
    try {
      if (parsed.command === "invoke") validateOperationId(operationId);
      const client = (dependencies.createClient ?? createClient)(parsed.config);
      if (parsed.command === "resource") {
        output.progress(operationId, "invoking");
        const result = await readResource(client, parsed.resourcePath, abort.signal);
        output.result(operationId, result);
      } else if (parsed.behavior === "event-stream") {
        output.progress(operationId, "following");
        await client.events((event) => output.event(event), { signal: abort.signal });
        if (abort.signal.aborted) throw abortError();
        output.result(operationId, {});
      } else if (parsed.behavior === "job-watch" && parsed.config.wait) {
        const input = await resolveCurrentTestRunInput(client, parsed, abort.signal, output);
        const result = await watchJob(
          client,
          operationId,
          input,
          abort.signal,
          output,
          dependencies.pollIntervalMs ?? 250,
        );
        assertOperationSucceeded(operationId, result, input, commandPath);
        output.result(operationId, summarizeResult(operationId, result, input, commandPath));
      } else if (parsed.behavior === "job-start-watch" && parsed.config.wait) {
        const input = await resolveCurrentTestRunInput(client, parsed, abort.signal, output);
        output.progress(operationId, "invoking");
        const started = await invokeOperation(client, operationId, input, abort.signal);
        output.snapshot(operationId, summarizeResult(operationId, started, input, commandPath));
        const jobIds = startedJobIds(started);
        const results: unknown[] = [];
        for (const jobId of jobIds) {
          results.push(
            await watchJob(
              client,
              "job.get",
              { jobId },
              abort.signal,
              output,
              dependencies.pollIntervalMs ?? 250,
            ),
          );
        }
        for (const result of results) assertOperationSucceeded(operationId, result);
        output.result(
          operationId,
          results.length === 1
            ? summarizeResult("job.get", results[0])
            : {
                jobs: results.map((result) =>
                  result && typeof result === "object" && "job" in result ? result.job : result,
                ),
              },
        );
      } else {
        const input = await resolveCurrentTestRunInput(client, parsed, abort.signal, output);
        output.progress(operationId, "invoking");
        const result = await invokeOperation(client, operationId, input, abort.signal);
        assertOperationSucceeded(operationId, result, input, commandPath);
        if (parsed.behavior === "screenshot") {
          await emitScreenshot(operationId, result, parsed.screenshotOutput, output);
        } else if (
          operationId === "target.snapshot.capture" &&
          parsed.screenshotOutput.kind === "file"
        ) {
          await emitSnapshotFile(operationId, result, parsed.screenshotOutput, output);
        } else if (
          parsed.operationId === "target.scroll-survey.capture" &&
          typeof input.dir === "string"
        ) {
          output.result(
            operationId,
            await persistScrollSurvey(input.dir, result, {
              force: parsed.surveyForce === true,
            }),
          );
        } else {
          output.result(operationId, summarizeResult(operationId, result, input, commandPath));
        }
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
