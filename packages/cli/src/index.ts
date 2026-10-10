#!/usr/bin/env tsx
import { isInteractiveReview, runReviewCommand, type ReviewClient } from "./review-command.js";
import { createBrowserCaptureWorkflow, type BrowserCapturePlan } from "@relay/workflows";
import { pathToFileURL } from "node:url";
import { targetExecutionReadiness, renderPlanFindingsMarkdown } from "@relay/core";
import {
  summarizeAuthoringOperationResult,
  summarizeExecutionOperationResult,
  summarizeTargetOperationResult,
  formatPlanCaptureReviewQueue,
  wantsFullSnapshotTree,
} from "@relay/protocol";
import type { OutputMode } from "./config.js";
import { parseCli } from "./config.js";
import {
  assertRecoverHasTarget,
  recoverInputFromLane,
  startedPlanBatchId,
} from "./cli-run-flags.js";
import { classifyError, CliError, ExitCode, UsageError } from "./errors.js";
import { planFindingsReportFromError } from "./plan-findings-cli.js";
import { renderHelp } from "./help.js";
import { summarizeTestDiscovery } from "./test-discovery.js";
import { savedPlanOperationInput, summarizeSavedPlanCommandResult } from "./plan-discovery.js";
import {
  createClient,
  invokeOperation,
  readResource,
  type ClientFactory,
  type OperationInvoker,
  validateOperationId,
} from "./invoke.js";
import { protocolOperationInput } from "./protocol-input.js";
import { CliOutput, formatTestCompileResult, type OutputStreams } from "./output.js";
import { liveTitleFromInput, watchJobsLive } from "./live-run-view.js";
import { abortError, waitForPoll } from "./outcome-wait.js";
export { assertOutcomeSucceeded, waitForOutcome } from "./outcome-wait.js";
import { teeWritable, writeRunOutDir } from "./cli-out.js";
import {
  exportWatchedCombinePack,
  finalizeCombineExportResult,
  WatchedRunOutput,
} from "./evidence-pack-cli.js";
import { emitScreenshot, emitSnapshotFile } from "./screenshot.js";
import { persistScrollSurvey, scrollSurveyPersistDigest } from "./survey-persist.js";
import { runDbCommand } from "./db-commands.js";
import { runGuideCommand } from "./guide-command.js";
import { runReportCommand } from "./report-commands.js";
import { ensureLocalRelayServer, type LocalServerResult } from "./local-server.js";
import {
  doctorExitCode,
  outcomeOperationId,
  runOutcomeCommand,
  verdictExitCode,
} from "./outcome-runner.js";
import { runEverydayCommand } from "./everyday-commands.js";
import { renamedCommandError } from "./cli-renames.js";
import { callerCwd, enterCallerCwd } from "./caller-cwd.js";
import {
  runVerifyChangeCommand,
  type VerifyChangeJobPoller,
  type VerifyChangeConfigReader,
  type VerifyChangeGitRunner,
  type VerifyChangeSleep,
} from "./verify-change-command.js";

export type CliDependencies = {
  env?: Record<string, string | undefined>;
  streams?: OutputStreams;
  createClient?: ClientFactory;
  registerSignalHandlers?: boolean;
  pollIntervalMs?: number;
  stdin?: NodeJS.ReadStream;
  ensureOutcomeServer?: (serverUrl: string) => Promise<LocalServerResult>;
  verifyChange?: {
    readConfig?: VerifyChangeConfigReader;
    git?: VerifyChangeGitRunner;
    cwd?: string;
    poll?: VerifyChangeJobPoller;
    sleep?: VerifyChangeSleep;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
  };
};

const processStreams: OutputStreams = { stdout: process.stdout, stderr: process.stderr };
const jobStatuses = new Set(["queued", "running", "paused", "ok", "error", "healed", "cancelled"]);
const terminalJobStatuses = new Set(["ok", "error", "healed", "cancelled"]);

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

const pausedPollIntervalMs = 5_000;

async function invoke(
  client: OperationInvoker,
  operationId: string,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  return invokeOperation(client, operationId, protocolOperationInput(operationId, input), signal);
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
  let pausedHintShown = false;
  while (true) {
    const result = await invoke(client, operationId, input, signal);
    if (signal.aborted) throw abortError();
    const status = jobStatus(result);
    output.snapshot(operationId, summarizeExecutionOperationResult(operationId, result));
    if (terminalJobStatuses.has(status)) return result;
    const job =
      result && typeof result === "object" && "job" in result
        ? (result.job as Record<string, unknown> | undefined)
        : undefined;
    const jobId = job && "id" in job && typeof job.id === "string" ? job.id : undefined;
    if (status === "paused" && !pausedHintShown) {
      pausedHintShown = true;
      output.pausedHint(jobId ?? operationId);
    }
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
    // A paused job needs a human (or an explicit resume); polling at the tight
    // interactive interval only burns requests against an unchanged state.
    await waitForPoll(status === "paused" ? pausedPollIntervalMs : pollIntervalMs, signal);
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
  // This explicit export needs the captured bytes for JSON and passive HTML.
  if (operationId === "run.walkthrough-pack.get") return result;
  const inner = summarizeExecutionOperationResult(
    operationId,
    summarizeSavedPlanCommandResult(
      operationId,
      summarizeAuthoringOperationResult(operationId, result),
      { commandPath, input },
    ),
  );
  if (operationId === "target.snapshot.capture" && wantsFullSnapshotTree(input)) return inner;
  return summarizeTargetOperationResult(
    operationId,
    summarizeTestDiscovery(operationId, result, inner, commandPath),
  );
}

function cliResourceSummaryOperationId(resourceId: string): string | undefined {
  if (resourceId === "run.get") return "run.get";
  if (resourceId === "run.evidence") return "run.evidence.get";
  if (resourceId === "run.story") return "run.story.get";
  if (resourceId === "run.compare") return "run.visual.compare";
  if (resourceId === "run.replay.offline") return "run.replay.offline";
  return undefined;
}

function summarizeResourceResult(resourceId: string, result: unknown): unknown {
  const operationId = cliResourceSummaryOperationId(resourceId);
  return operationId ? summarizeExecutionOperationResult(operationId, result) : result;
}

function summarizedJobFromWatch(result: unknown): unknown {
  const summarized = summarizeResult("job.get", result);
  if (summarized && typeof summarized === "object" && "job" in summarized) {
    return summarized.job;
  }
  return summarized;
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
 * from treating a structured `{ ok: false }` result or failed job as a pass.
 * These are server-reported failures (exit 9), not client-side input problems
 * (exit 5): the request parsed and ran, so retrying or reporting differs. */
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
      ExitCode.operationFailure,
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
        ExitCode.operationFailure,
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

/** The first two words, skipping flags (the local `system db` and
 * `proof report` commands take no flag values before them). */
function leadingPositionals(argv: readonly string[]): string[] {
  return argv.filter((token) => !token.startsWith("-") || token === "-").slice(0, 2);
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
  if (parsed.operationId === "target.recover") assertRecoverHasTarget(parsed.input);
  if (parsed.operationId === "target.recover" && typeof parsed.input.laneId === "string") {
    const response = object(await invoke(client, "lane.list", {}, signal), "lane.list");
    const lanes = Array.isArray(response.lanes)
      ? response.lanes.filter(
          (
            value,
          ): value is {
            id?: string;
            target?: { kind?: string; serial?: string; browserTargetId?: string };
          } => Boolean(value) && typeof value === "object",
        )
      : [];
    return recoverInputFromLane(parsed.input, lanes);
  }
  if (!parsed.currentTarget && !parsed.currentRevision) return parsed.input;
  const appMapId = parsed.input.appMapId;
  if (typeof appMapId !== "string" || !appMapId) {
    throw new UsageError("current revision/target shortcuts require an App Map id");
  }
  const next = { ...parsed.input };
  if (parsed.currentRevision) {
    const response = object(
      await invoke(client, "app-map.get", { appMapId }, signal),
      "app-map.get",
    );
    const appMap = object(response.appMap, "app-map.get appMap");
    if (typeof appMap.revision !== "number") {
      throw new UsageError("The current App Map has no numeric revision");
    }
    if (parsed.operationId === "app-map.test.run") {
      next.expectedRevision = appMap.revision;
    } else {
      output.heartbeat(`Resolved Plan revision ${appMap.revision}`);
    }
  }
  if (parsed.currentTarget) {
    const response = object(
      await invoke(client, "target.devices.list", {}, signal),
      "target.devices.list",
    );
    const devices = Array.isArray(response.devices)
      ? response.devices.filter((value) => value && typeof value === "object")
      : [];
    const runnableDevices = devices.filter((device) => {
      if (typeof device.platform !== "string") return false;
      return targetExecutionReadiness(device as Parameters<typeof targetExecutionReadiness>[0])
        .runnable;
    });
    if (runnableDevices.length !== 1) {
      throw new UsageError(
        runnableDevices.length > 1
          ? `--target current is ambiguous: ${runnableDevices.length} runnable targets are connected`
          : devices.length
            ? `--target current found no runnable target: ${devices
                .map((device) => {
                  if (typeof device.platform !== "string") return "unsupported target";
                  const readiness = targetExecutionReadiness(
                    device as Parameters<typeof targetExecutionReadiness>[0],
                  );
                  return readiness.runnable
                    ? "target is available"
                    : `${readiness.reason}: ${readiness.recovery}`;
                })
                .join("; ")}`
            : "--target current found no connected target",
      );
    }
    const device = object(runnableDevices[0], "connected target");
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
  let streams = dependencies.streams ?? processStreams;
  let output = new CliOutput(fallbackMode(argv), argv.includes("--quiet"), streams);
  let operationId: string | undefined;
  let findingsRequested = false;
  let watchedRunOutput: WatchedRunOutput | undefined;
  let outDir: string | undefined;
  let readStderr = (): string => "";
  const persistOut = async (code: number): Promise<number> => {
    if (!outDir) return code;
    try {
      await writeRunOutDir({
        dir: outDir,
        envelope: output.terminal ?? {
          type: "error",
          ok: false,
          error: { message: "No CLI result" },
        },
        stderr: readStderr(),
      });
      return code;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      streams.stderr.write(`relay: could not write --out directory: ${message}\n`);
      return code === ExitCode.success ? ExitCode.validation : code;
    }
  };
  try {
    if (firstPositional(argv) === "guide") {
      operationId = "local.guide";
      return runGuideCommand(argv, streams);
    }
    // Old spellings fail before any flag parsing so `relay proof report --run x`
    // points at its new path instead of rejecting a flag the new path accepts.
    const firstFlag = argv.findIndex((token) => token.startsWith("-"));
    const leadingWords = firstFlag < 0 ? argv : argv.slice(0, firstFlag);
    const renamed = renamedCommandError(leadingWords);
    if (renamed) throw renamed;
    const [first, second] = leadingPositionals(argv);
    if (first === "system" && second === "db") {
      return await runDbCommand(argv, streams, dependencies.env ?? process.env);
    }
    if (first === "proof" && second === "report") {
      return await runReportCommand(argv, streams, dependencies.env ?? process.env);
    }
    const everyday = await runEverydayCommand(argv, {
      streams,
      env: dependencies.env ?? process.env,
      createClient: dependencies.createClient ?? createClient,
      ensureServer: dependencies.ensureOutcomeServer ?? ensureLocalRelayServer,
      pollIntervalMs: dependencies.pollIntervalMs ?? 250,
      registerSignalHandlers: dependencies.registerSignalHandlers !== false,
    });
    if (everyday !== undefined) return everyday;
    if (isInteractiveReview(argv)) {
      return await runReviewCommand(argv, {
        streams,
        env: dependencies.env ?? process.env,
        stdin: dependencies.stdin ?? process.stdin,
        client: (args) =>
          (dependencies.createClient ?? createClient)(
            parseCli(args, dependencies.env ?? process.env).config,
          ) as unknown as ReviewClient,
      });
    }
    const parsed = parseCli(argv, dependencies.env ?? process.env);
    if ((parsed.command === "invoke" || parsed.command === "outcome") && parsed.outDir) {
      outDir = parsed.outDir;
      const tee = teeWritable(streams.stderr);
      streams = { stdout: streams.stdout, stderr: tee.writable };
      readStderr = tee.text;
    }
    output = new CliOutput(parsed.config.output, parsed.config.quiet, streams);
    findingsRequested =
      parsed.command === "invoke" && "findings" in parsed && parsed.findings === true;
    if (parsed.command === "help") {
      streams.stdout.write(renderHelp(parsed.helpFamily));
      return ExitCode.success;
    }
    if (parsed.command === "browser-capture-plan") {
      const client = (dependencies.createClient ?? createClient)(parsed.config);
      const result = await createBrowserCaptureWorkflow({
        invoke: (id, input) => client.invoke(id, input as never),
      }).save(parsed.input as BrowserCapturePlan);
      output.result("browser.capture-plan", {
        appMapId: result.appMap.id,
        revision: result.appMap.revision,
        testId: result.testId,
        variableId: result.variableId,
      });
      return ExitCode.success;
    }
    operationId =
      parsed.command === "invoke"
        ? parsed.operationId
        : parsed.command === "resource"
          ? parsed.resourceId
          : parsed.command === "prove"
            ? "proof.start"
            : outcomeOperationId(parsed.intent.kind);
    const commandPath = "commandPath" in parsed ? parsed.commandPath : undefined;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    if (dependencies.registerSignalHandlers !== false) {
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
    }
    try {
      let exitCode: ExitCode = ExitCode.success;
      if (parsed.command === "invoke") validateOperationId(operationId);
      if (
        ((parsed.command === "outcome" && parsed.intent.kind !== "replay-lab") ||
          (parsed.command === "prove" && parsed.confirm)) &&
        parsed.config.ensureLocalServer
      ) {
        output.heartbeat("Ensuring the local Relay server is ready");
        await (dependencies.ensureOutcomeServer ?? ensureLocalRelayServer)(
          parsed.config.connection.url,
        );
      }
      const client = (dependencies.createClient ?? createClient)(parsed.config);
      if (parsed.command === "prove") {
        const result = await runVerifyChangeCommand({
          base: parsed.base,
          configFile: parsed.configFile,
          confirm: parsed.confirm,
          cwd: dependencies.verifyChange?.cwd ?? callerCwd(dependencies.env ?? process.env),
          readConfig: dependencies.verifyChange?.readConfig,
          git: dependencies.verifyChange?.git,
          actorKind: parsed.config.connection.actorKind,
          poll: dependencies.verifyChange?.poll,
          sleep: dependencies.verifyChange?.sleep,
          pollIntervalMs: dependencies.verifyChange?.pollIntervalMs ?? dependencies.pollIntervalMs,
          pollTimeoutMs: dependencies.verifyChange?.pollTimeoutMs,
          client,
          signal: abort.signal,
        });
        output.result(operationId, result);
      } else if (parsed.command === "outcome") {
        output.progress(operationId, "invoking");
        const result = await runOutcomeCommand({
          parsed,
          client,
          signal: abort.signal,
          output,
          pollIntervalMs: dependencies.pollIntervalMs ?? 250,
          env: dependencies.env ?? process.env,
        });
        const outcomeCode = verdictExitCode(result) ?? doctorExitCode(result);
        output.result(
          operationId,
          result,
          outcomeCode === undefined || outcomeCode === ExitCode.success,
        );
        if (outcomeCode !== undefined) exitCode = outcomeCode;
      } else if (parsed.command === "resource") {
        output.progress(operationId, "invoking");
        const result = await readResource(client, parsed.resourcePath, abort.signal);
        output.result(operationId, summarizeResourceResult(operationId, result));
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
        const started = await invoke(client, operationId, input, abort.signal);
        output.snapshot(operationId, summarizeResult(operationId, started, input, commandPath));
        const jobIds = startedJobIds(started);
        const view = output.liveView({ title: liveTitleFromInput(input, operationId) });
        const results: unknown[] = view
          ? await watchJobsLive({
              jobIds,
              view,
              fetch: (jobId) => invoke(client, "job.get", { jobId }, abort.signal),
              isTerminal: (result) =>
                result !== undefined && terminalJobStatuses.has(jobStatus(result)),
              wait: (ms) => waitForPoll(ms, abort.signal),
              pollIntervalMs: dependencies.pollIntervalMs ?? 250,
            })
          : [];
        if (!view) {
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
        }
        let watchFailure: unknown;
        try {
          for (const result of results) assertOperationSucceeded(operationId, result);
        } catch (error) {
          watchFailure = error;
        }
        watchedRunOutput = new WatchedRunOutput(
          output,
          operationId,
          results.length === 1
            ? summarizeResult("job.get", results[0])
            : { jobs: results.map(summarizedJobFromWatch) },
          parsed.config.output,
        );
        if (!watchFailure) watchedRunOutput.executionSucceeded();
        if (parsed.findings) {
          const batchId = startedPlanBatchId(started);
          if (!batchId) {
            if (watchFailure) throw watchFailure;
            throw new Error("Plan findings need a campaign or batch id");
          }
          const analysis = await invoke(
            client,
            "job.combine.analysis",
            { batchId, ...(parsed.triage === "jev" ? { triage: "jev" } : {}) },
            abort.signal,
          );
          watchedRunOutput.phase(
            "job.combine.analysis",
            "findings",
            parsed.config.output === "human"
              ? renderPlanFindingsMarkdown(
                  analysis as Parameters<typeof renderPlanFindingsMarkdown>[0],
                )
              : summarizeResult("job.combine.analysis", analysis),
          );
        }
        if (watchFailure) throw watchFailure;
        const evidencePack = await exportWatchedCombinePack({
          operationId,
          exportDir: "exportDir" in parsed ? parsed.exportDir : undefined,
          todoFile: "todoFile" in parsed ? parsed.todoFile : undefined,
          started,
          invoke: async (id, payload) => {
            const result = await invoke(client, id, payload, abort.signal);
            assertOperationSucceeded(id, result);
            return result;
          },
        });
        if (evidencePack !== undefined)
          watchedRunOutput.phase("job.combine.export", "evidencePack", evidencePack);
        watchedRunOutput.finish();
      } else {
        const input = await resolveCurrentTestRunInput(client, parsed, abort.signal, output);
        const surveyDir = typeof input.dir === "string" ? input.dir : undefined;
        output.progress(operationId, "invoking");
        const result = await invoke(
          client,
          operationId,
          savedPlanOperationInput(operationId, input, commandPath),
          abort.signal,
        );
        assertOperationSucceeded(operationId, result, input, commandPath);
        if (parsed.behavior === "screenshot") {
          await emitScreenshot(operationId, result, parsed.screenshotOutput, output);
        } else if (
          operationId === "target.snapshot.capture" &&
          parsed.screenshotOutput.kind === "file"
        ) {
          await emitSnapshotFile(operationId, result, parsed.screenshotOutput, output);
        } else if (parsed.operationId === "target.scroll-survey.capture" && surveyDir) {
          output.result(
            operationId,
            scrollSurveyPersistDigest(result) ??
              (await persistScrollSurvey(surveyDir, result, {
                force: parsed.surveyForce === true,
              })),
          );
        } else if (operationId === "job.combine.analysis" && parsed.config.output === "human") {
          output.result(
            operationId,
            renderPlanFindingsMarkdown(result as Parameters<typeof renderPlanFindingsMarkdown>[0]),
          );
        } else if (
          operationId === "job.combine.capture.review" &&
          parsed.config.output === "human"
        ) {
          const summarized = summarizeResult(operationId, result, input, commandPath) as {
            queue?: Parameters<typeof formatPlanCaptureReviewQueue>[0];
          };
          output.result(
            operationId,
            summarized.queue ? formatPlanCaptureReviewQueue(summarized.queue) : summarized,
          );
        } else {
          const outputResult = await finalizeCombineExportResult({
            operationId,
            result,
            summarized: summarizeResult(operationId, result, input, commandPath),
            exportDir: "exportDir" in parsed ? parsed.exportDir : undefined,
            todoFile: "todoFile" in parsed ? parsed.todoFile : undefined,
          });
          const humanCompileOutput =
            operationId === "app-map.test.compile" && parsed.config.output === "human"
              ? parsed.full
                ? JSON.stringify(result, null, 2)
                : formatTestCompileResult(result)
              : undefined;
          output.result(operationId, outputResult, true, humanCompileOutput);
        }
      }
      return await persistOut(exitCode);
    } finally {
      if (dependencies.registerSignalHandlers !== false) {
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
      }
    }
  } catch (error) {
    const classified = classifyError(error);
    if (findingsRequested && fallbackMode(argv) === "human") {
      const report = planFindingsReportFromError(classified.details);
      if (report) output.result("job.combine.analysis", renderPlanFindingsMarkdown(report));
    }
    output.error(classified, operationId, watchedRunOutput?.retainedResult);
    return await persistOut(classified.exitCode);
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  enterCallerCwd();
  process.exitCode = await runCli(process.argv.slice(2));
}
