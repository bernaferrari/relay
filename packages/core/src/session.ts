/** Test-run sessions with action traces, heal retries, and disk persistence. */
import { now, publish } from "./events.js";
import { resetDeviceClient, type Device } from "./device.js";
import { closeBrowserTarget } from "./browser-target.js";
import { runWithTargetContext } from "./target-context.js";
import type { Glyph, TraceFrameRef, TraceStep } from "./trace.js";
import { persistRun, writeFramePng, ensureRunDir, type PersistedRun } from "./runs.js";
import {
  compensatingCleanupIsArmed,
  JobCancelledError,
  JobControlOwnershipError,
  clearControl,
  ensureControl,
  requestCancel,
  requestPause,
  requestResume,
  runWithJobControl,
  setControlValidator,
  cooperativeCheckpoint,
  throwIfCancelled,
  hardStopDeviceSession,
} from "./control.js";
import { readRecipe, freezeRecipeExecution, describeRecipeStep, glyphsForStep } from "./recipes.js";
import { resolveRecipeStep, runRecipeStep } from "./recipe-runner.js";
import type { RecipeRuntimeState } from "./recipe-runner-context.js";
import { finalizeDeferredChecksForJob } from "./session-campaign-finalization.js";
import { classifyRunOutcome } from "./outcomes.js";
import { redactPrivateValue } from "./private-inputs.js";
import {
  initializeRunEvidence,
  runEvidenceFinalizationDevice,
  startRunEvidence,
  stopRunEvidence,
  type RunEvidenceHandle,
} from "./run-evidence.js";
import { TargetWorkerScheduler, type TargetWorkerStatus } from "./target-worker.js";
import { requireOperationContext, runWithOperationContext } from "./operation-context.js";
import { redactText, visualEvidenceAllowed } from "./redaction.js";
import { projectPersistedAppMapRun } from "./app-map-run-history.js";
import { JobRegistry } from "./job-registry.js";
import { releaseTargetControl, reserveTargetControl } from "./target-control.js";
import {
  classifySessionError,
  createJobLeaseValidator,
  failedCampaignChecks,
} from "./session-job-support.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";
import { isTargetUnavailableError } from "./target-unavailable.js";
import { humanInterventionNeedsReproof } from "./job-intervention.js";
import { captureAutomaticState } from "./session-automatic-evidence.js";
import { appendStepLog, finishStep, observeStepActions, openStep } from "./session-trace-steps.js";
import {
  createSessionJob,
  prepareSameConfigurationReplay,
  replayInputFromPersistedRun,
  retryInputFromJob,
  type PersistedReplayMode,
} from "./session-job-factory.js";
import {
  createDurableSessionHeartbeat,
  finishDurableSessionJob,
  runScheduledSessionJob,
  setDurableSessionPaused,
} from "./session-durable-worker.js";
import {
  prepareSessionJobBatch,
  scheduledSessionJob,
  type DeferredSessionJobBatch,
  type SessionBatchInput,
} from "./session-batch-admission.js";
import { commitTerminalSessionRun } from "./session-terminal-persistence.js";
import { shutdownSessionExecutions } from "./session-execution-shutdown.js";
import {
  currentTargetSupervisorStore,
  runWithTargetSupervisorStore,
} from "./target-supervisor-store.js";
import {
  AppMapTestExecutionReviewRequiredError,
  appMapTestExecutionSourceFromJob,
  appMapTestExecutionSourceFromRun,
  requireScopedAppMapTestExecutionSource,
  revalidateAppMapTestExecutionSource,
} from "./app-map-test-execution-gate.js";
import {
  acquirePreparedSessionDevice,
  assertProviderTargetJobAdmission,
  captureProviderDriverRegistry,
  prepareSessionTarget,
  runProviderTargetJobIfNeeded,
  type ProviderSessionExecution,
} from "./session-provider-execution.js";
import { attachDestinationRepairProposals } from "./session-repair-attachment.js";
import { automaticEvidencePhases } from "./session-evidence-phases.js";
export { automaticEvidencePhases } from "./session-evidence-phases.js";
export type { EnqueueJobInput, JobErrorCode, JobStatus, TestJob } from "./session-contract.js";
export { summarizeJob } from "./session-summary.js";
export { captureAutomaticState } from "./session-automatic-evidence.js";
export { replayInputFromPersistedRun } from "./session-job-factory.js";

const MAX_JOBS = 100;
const jobRegistry = new JobRegistry<TestJob>(MAX_JOBS);
const jobCompletions = new WeakMap<TestJob, { promise: Promise<void>; resolve: () => void }>();
const activeJobIds = new Set<string>();
const scheduler = new TargetWorkerScheduler();

function isJobCancellation(error: unknown): boolean {
  return (
    error instanceof JobCancelledError ||
    (error instanceof Error && error.name === "JobCancelledError")
  );
}

export function listJobs(limit = 50): TestJob[] {
  return jobRegistry.list(limit);
}

export function getJob(id: string): TestJob | undefined {
  return jobRegistry.get(id);
}
/** Wait for terminal persistence and lifecycle cleanup, not merely terminal status. */
export async function waitForJobCompletion(id: string): Promise<TestJob> {
  const job = jobRegistry.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  const completion = jobCompletions.get(job);
  if (!completion) throw new Error(`Job ${id} has no execution lifecycle`);
  await completion.promise;
  return job;
}

/** Stop session input before a hosting server hands its state directory over. */
export const shutdownSessionExecution = (timeoutMs?: number) =>
  shutdownSessionExecutions(
    { activeJobs: getActiveJobs, cancelJob, waitForCompletion: waitForJobCompletion },
    { timeoutMs },
  );

export function getActiveJobs(): TestJob[] {
  return jobRegistry
    .listAll()
    .filter((job) => ["queued", "running", "paused"].includes(job.status));
}

export function getActiveJob(targetId?: string): TestJob | null {
  const occupying = getActiveJobs();
  if (!targetId) return occupying.find((job) => job.status === "running") ?? occupying[0] ?? null;
  return occupying.find((job) => (job.browserTargetId ?? job.serial) === targetId) ?? null;
}

export const listTargetWorkers = (): TargetWorkerStatus[] => scheduler.statuses();

function setOutcome(job: TestJob): void {
  const classified = classifyRunOutcome(job);
  job.outcome = classified.outcome;
  job.failureCategory = classified.failureCategory;
}

/** Re-run an immutable persisted execution and preserve its source lineage. */
export function replayPersistedRun(
  run: PersistedRun,
  mode: PersistedReplayMode = "saved-steps",
): TestJob {
  if (mode === "same-configuration") {
    throw new Error(
      "Same-configuration replay requires prepareSameConfigurationReplay before enqueue",
    );
  }
  requireScopedAppMapTestExecutionSource(appMapTestExecutionSourceFromRun(run));
  return enqueueJob({ ...replayInputFromPersistedRun(run, mode), retryOf: run.id });
}

export { prepareSameConfigurationReplay };

function makeJob(input: EnqueueJobInput, attemptSeed = 1): TestJob {
  const job = createSessionJob(input, {
    findJob: (id) => jobRegistry.get(id),
    toTransport: jobForTransport,
    attemptSeed,
  });
  captureProviderDriverRegistry(job);
  return job;
}

/** The runtime keeps private values only in memory for step resolution. Every
 * HTTP, MCP, event, and JSON boundary receives this redacted projection. */
export function jobForTransport(job: TestJob): TestJob {
  return redactPrivateValue(
    Object.fromEntries(Object.entries(job).filter(([key]) => key !== "toJSON")),
    job.resolvedInputs,
    job.sensitiveInputNames ?? [],
  ) as TestJob;
}

export function prepareJobBatch(inputs: readonly SessionBatchInput[]): DeferredSessionJobBatch {
  requireOperationContext();
  return prepareSessionJobBatch(inputs, {
    createJob: (input) => makeJob(input),
    validateJob: (job) => {
      requireScopedAppMapTestExecutionSource(appMapTestExecutionSourceFromJob(job));
      assertProviderTargetJobAdmission(job);
    },
    registerCompletion(job) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => (resolve = done));
      jobCompletions.set(job, { promise, resolve });
    },
    forgetCompletion: (job) => jobCompletions.delete(job),
    linkRetry(input, job) {
      if (!input.retryOf) return;
      const parent = jobRegistry.get(input.retryOf);
      if (parent) parent.retriedBy = job.id;
    },
    unlinkRetry(input, job) {
      if (!input.retryOf) return;
      const parent = jobRegistry.get(input.retryOf);
      if (parent?.retriedBy === job.id) parent.retriedBy = undefined;
    },
    remember: (job) => jobRegistry.remember(job),
    forgetUnstarted: (job) => jobRegistry.forgetUnstarted(job),
    reserveTargetControl: (job) => {
      if (job.targetContext.kind === "device") {
        reserveTargetControl(job.targetContext.serial, job.id);
      }
    },
    releaseTargetControl: (job) => {
      if (job.targetContext.kind === "device") {
        releaseTargetControl(job.targetContext.serial, job.id);
      }
    },
    scheduler,
    schedule: (job) => {
      // Worker callbacks run after request-local AsyncLocalStorage has ended.
      // Capture the server-owned supervisor explicitly so physical iOS proof
      // Runs retain the same durable mutation boundary when the queue drains.
      const supervisorStore = currentTargetSupervisorStore();
      return scheduledSessionJob({
        job,
        run: async () => {
          try {
            const run = () =>
              runScheduledSessionJob({
                job,
                execute: (workerInstanceId) => {
                  const execute = () =>
                    runWithJobControl(job.id, () =>
                      runWithTargetContext(job.targetContext, () =>
                        executeJob(job.id, workerInstanceId),
                      ),
                    );
                  return job.operationContext
                    ? runWithOperationContext(job.operationContext, execute)
                    : execute();
                },
                onDispatchFailure: (error) =>
                  finishPreExecutionFailure(
                    job,
                    `Durable worker dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                onDurabilityFailure: (error) =>
                  publish({
                    type: "error",
                    at: now(),
                    message: error instanceof Error ? error.message : String(error),
                    where: "session.durable-worker.finish",
                  }),
              });
            await (supervisorStore ? runWithTargetSupervisorStore(supervisorStore, run) : run());
          } finally {
            jobCompletions.get(job)?.resolve();
          }
        },
      });
    },
  });
}

export function enqueueJob(input: EnqueueJobInput): TestJob {
  return prepareJobBatch([{ input }]).commit()[0]!;
}

/** Re-run a failed (or any) job — success after failure marks healed. */
export function retryJob(id: string): TestJob {
  const parent = jobRegistry.get(id);
  if (!parent) throw new Error(`Unknown job: ${id}`);
  requireScopedAppMapTestExecutionSource(appMapTestExecutionSourceFromJob(parent));
  return enqueueJob(retryInputFromJob(parent));
}

const commitTerminalRun = (job: TestJob, log: (line: string) => void) =>
  commitTerminalSessionRun(job, log, {
    persistRun,
    projectPersistedRun: projectPersistedAppMapRun,
    now,
    setOutcome,
  });

/** Finish a job before creating a device client. Queue admission is
 * synchronous; this protects a long-waiting job from stale frozen evidence or
 * a durable-dispatch failure without sending another input to the target. */
async function finishPreExecutionFailure(job: TestJob, error: string): Promise<void> {
  job.startedAt = now();
  job.finishedAt = job.startedAt;
  job.status = "error";
  job.error = error;
  job.errorCode = classifySessionError(job.error);
  job.logs.push(`==> FAIL: ${job.error}`);
  setOutcome(job);
  await commitTerminalRun(job, (line) => job.logs.push(line));
  publish({
    type: "job.finished",
    at: job.finishedAt,
    jobId: job.id,
    action: job.action,
    ok: false,
    error: job.error,
    durationMs: 0,
  });
  if (job.targetContext.kind === "device") {
    releaseTargetControl(job.targetContext.serial, job.id);
  }
  clearControl(job.id);
  jobRegistry.pruneTerminalHistory();
}

function finalizeCancelled(job: TestJob, primary?: TraceStep): void {
  job.finishedAt = now();
  job.status = "cancelled";
  job.error = "Cancelled by user";
  job.errorCode = "CANCELLED";
  setOutcome(job);
  if (primary) finishStep(primary, "error", "✗ cancelled");
  publish({
    type: "job.cancelled",
    at: job.finishedAt,
    jobId: job.id,
    action: job.action,
  });
  publish({
    type: "job.finished",
    at: job.finishedAt,
    jobId: job.id,
    action: job.action,
    ok: false,
    error: job.error,
    durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
    cancelled: true,
  });
}

/** Cancel a queued or in-flight job. A currently armed compensating cleanup
 * gets one bounded chance to finish; every other run is hard-stopped. */
export function cancelJob(id: string): TestJob {
  const job = jobRegistry.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);

  if (
    job.status === "ok" ||
    job.status === "error" ||
    job.status === "healed" ||
    job.status === "cancelled"
  ) {
    return job;
  }

  requestCancel(id);
  const finishCompensatingCleanup = compensatingCleanupIsArmed(id);
  if ((job.status === "running" || job.status === "paused") && !finishCompensatingCleanup) {
    // Provider sessions have no AgentDevice session to close. A registered
    // provider owns any cancellation transport behind its driver boundary.
    if (job.targetContext.kind === "device") {
      void hardStopDeviceSession(job.targetContext);
      resetDeviceClient(job.targetContext);
    }
  }

  if (job.status === "queued") {
    scheduler.remove(id);
    if (job.targetContext.kind === "device") releaseTargetControl(job.targetContext.serial, job.id);
    job.startedAt = job.startedAt ?? now();
    finalizeCancelled(job);
    void persistRun(job)
      .then(() => {
        try {
          // A queued assignment is allowed to become terminal only after its
          // terminal run manifest commits. If writing the manifest fails, a
          // future server deliberately reports recovery-required instead.
          finishDurableSessionJob(job);
        } catch (error) {
          publish({
            type: "error",
            at: now(),
            message: error instanceof Error ? error.message : String(error),
            where: "session.durable-worker.finish",
          });
        }
        jobRegistry.pruneTerminalHistory();
      })
      .catch(() => undefined)
      .finally(() => jobCompletions.get(job)?.resolve());
    clearControl(id);
    return job;
  }

  const cancellationLog = finishCompensatingCleanup
    ? "==> cancel requested (finishing reviewed cleanup)"
    : "==> cancel requested (hard-stop session)";
  job.logs.push(cancellationLog);
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: cancellationLog,
    level: "info",
  });
  return job;
}

/** Pause a running job (cooperative — takes effect at next sleep/checkpoint). */
export function pauseJob(id: string): TestJob {
  const job = jobRegistry.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  if (job.status !== "running") {
    throw new Error(`Cannot pause job in status ${job.status}`);
  }
  setDurableSessionPaused(job.id, true);
  requestPause(id);
  job.status = "paused";
  job.logs.push("==> paused");
  publish({ type: "job.paused", at: now(), jobId: job.id, action: job.action });
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: "==> paused (Esc/Cancel still tests)",
    level: "info",
  });
  return job;
}

/** Resume a paused job only after reproducing the frozen offline proof. */
export async function resumeJob(id: string): Promise<TestJob> {
  const job = jobRegistry.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  const executionIntent = await revalidateAppMapTestExecutionSource(
    appMapTestExecutionSourceFromJob(job),
  );
  if (executionIntent.status === "review-required") {
    throw new AppMapTestExecutionReviewRequiredError(executionIntent.reason);
  }
  if (job.status !== "paused") {
    throw new Error(`Cannot resume job in status ${job.status}`);
  }
  if (humanInterventionNeedsReproof(job)) {
    throw new Error("Cannot resume after manual intervention until the target state is re-proven");
  }
  setDurableSessionPaused(job.id, false);
  requestResume(id);
  job.status = "running";
  job.logs.push("==> resumed");
  publish({ type: "job.resumed", at: now(), jobId: job.id, action: job.action });
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: "==> resumed",
    level: "info",
  });
  return job;
}

/** Cancel the active job if any. */
export function cancelActiveJob(targetId?: string): TestJob | null {
  const active = getActiveJob(targetId);
  if (!active) return null;
  return cancelJob(active.id);
}

/** Run a frozen recipe as traced, cancellable device actions. */
async function runRecipeSteps(
  job: TestJob,
  device: Device,
  pushLog: (line: string) => void,
  setCurrentStep: (step: TraceStep | undefined) => void,
): Promise<void> {
  const recipeId = job.recipeId;
  if (!recipeId) throw new Error("recipe job has no recipeId");
  const recipe = job.recipeSnapshot ?? (await readRecipe(recipeId));
  if (!recipe) throw new Error(`recipe not found: ${recipeId}`);
  if (!job.recipeSnapshot) job.recipeSnapshot = structuredClone(recipe);
  job.resolvedInputs = { ...recipe.variables, ...job.resolvedInputs };
  const runtime: RecipeRuntimeState = {};
  pushLog(`==> recipe: ${recipe.title} · ${recipe.steps.length} step(s)`);
  for (const [stepIndex, step] of recipe.steps.entries()) {
    await cooperativeCheckpoint(job.id);
    // The generated TraceStep id is intentionally opaque and changes on every
    // run. Carry the frozen recipe identity alongside it so persisted evidence
    // can join back to the authored Test provenance without guessing by UUID.
    const recipeStepId = step.id?.trim() || `${recipeId}:${stepIndex + 1}`;
    const ts = openStep(job, {
      recipeId,
      recipeStepId,
      kind: "Replay",
      tone: "acc",
      title: describeRecipeStep(step),
      glyphs: glyphsForStep(step),
      status: "running",
    });
    setCurrentStep(ts);
    try {
      observeStepActions(ts, glyphsForStep(step));
      const resolvedStep = resolveRecipeStep(step, job.resolvedInputs);
      job.artifacts.push({
        kind: "command-attempt",
        capturedAt: now(),
        data: { stepId: ts.id, command: resolvedStep },
      });
      const evidencePhases = automaticEvidencePhases(resolvedStep);
      if (evidencePhases.includes("before"))
        await captureAutomaticState(job, device, ts, "before", pushLog, runtime);
      await runRecipeStep(device, resolvedStep, {
        log: pushLog,
        job,
        recipeGraph: job.recipeGraph,
        runtime,
      });
      if (evidencePhases.includes("after"))
        await captureAutomaticState(job, device, ts, "after", pushLog, runtime);
      finishStep(ts, "ok");
    } catch (err) {
      // A failure frame remains useful when passive-step evidence is suppressed.
      // Cancellation hard-stops the native session before it reaches this
      // boundary. Preserve already-buffered evidence instead of issuing a
      // fresh query against the destroyed adapter.
      if (!isJobCancellation(err) && !isTargetUnavailableError(err)) {
        await captureAutomaticState(job, device, ts, "after", pushLog, runtime);
      }
      await attachDestinationRepairProposals(job, err, runtime).catch(() => {
        // Proposal generation is advisory: never let it mask the original
        // step failure propagating from the catch below.
      });
      throw err;
    }
  }
  finalizeDeferredChecksForJob(job, pushLog, runtime);
  setCurrentStep(undefined);
}

async function executeJob(id: string, workerInstanceId?: string): Promise<void> {
  const job = jobRegistry.get(id);
  if (!job) {
    const message = `Job registry invariant violated: scheduled job ${id} is missing`;
    publish({ type: "error", at: now(), message, where: "session.executeJob" });
    throw new Error(message);
  }
  if (jobRegistry.get(id)?.status === "cancelled") return;

  const executionIntent = await revalidateAppMapTestExecutionSource(
    appMapTestExecutionSourceFromJob(job),
  );
  // Revalidation is filesystem-only but asynchronous. A queued cancellation
  // may have won while it was reading frozen evidence; never recreate control
  // or start a device client after that terminal transition.
  if (jobRegistry.get(id)?.status === "cancelled") return;
  if (executionIntent.status === "review-required") {
    await finishPreExecutionFailure(
      job,
      `App Map Test execution needs review: ${executionIntent.reason}`,
    );
    return;
  }

  if (
    await runProviderTargetJobIfNeeded(job, (providerExecution) =>
      executeJobOnTarget(job, workerInstanceId, providerExecution),
    )
  )
    return;

  await executeJobOnTarget(job, workerInstanceId);
}

/** Execute the generic lifecycle after a target-specific boundary has chosen
 * its provider-owned or local Device facade. */
async function executeJobOnTarget(
  job: TestJob,
  workerInstanceId?: string,
  providerExecution?: ProviderSessionExecution,
): Promise<void> {
  const id = job.id;
  ensureControl(id);
  const validateLease = createJobLeaseValidator(job);
  if (validateLease) {
    setControlValidator(id, validateLease);
    try {
      await cooperativeCheckpoint(id);
    } catch (error) {
      job.startedAt = now();
      if (isJobCancellation(error)) {
        finalizeCancelled(job);
      } else {
        const message =
          error instanceof JobControlOwnershipError ||
          (error instanceof Error && error.name === "JobControlOwnershipError")
            ? "Job control lease is no longer valid"
            : "Job control ownership could not be validated";
        job.finishedAt = job.startedAt;
        job.status = "error";
        job.error = message;
        job.errorCode = classifySessionError(message);
        job.logs.push(`==> FAIL: ${message}`);
        setOutcome(job);
        publish({
          type: "job.finished",
          at: job.finishedAt,
          jobId: job.id,
          action: job.action,
          ok: false,
          error: message,
          durationMs: 0,
        });
      }
      await commitTerminalRun(job, (line) => job.logs.push(line));
      if (job.targetContext.kind === "device")
        releaseTargetControl(job.targetContext.serial, job.id);
      clearControl(id);
      jobRegistry.pruneTerminalHistory();
      return;
    }
  }
  activeJobIds.add(id);
  job.status = "running";
  job.startedAt = now();
  const target = await prepareSessionTarget(job, providerExecution);
  if (target.deviceName) job.deviceName = target.deviceName;
  await ensureRunDir(job).catch(() => undefined);

  publish({
    type: "job.started",
    at: job.startedAt,
    jobId: job.id,
    action: job.action,
    serial: job.serial,
  });

  let currentRecipeStep: TraceStep | undefined;

  const pushLog = (line: string) => {
    const safeLine = redactPrivateValue(
      redactText(line),
      job.resolvedInputs,
      job.sensitiveInputNames ?? [],
    );
    job.logs.push(safeLine);
    appendStepLog(currentRecipeStep, safeLine);
    const level = /FAIL|error|Error|cancel/i.test(safeLine)
      ? ("error" as const)
      : /DONE|success|resumed|paused/i.test(safeLine)
        ? ("success" as const)
        : ("info" as const);
    publish({ type: "job.log", at: now(), jobId: job.id, line: safeLine, level });
  };

  const primary = () => currentRecipeStep ?? job.steps[job.steps.length - 1];
  let device: Device | undefined;
  let evidence: RunEvidenceHandle | undefined = initializeRunEvidence(job);
  const releaseOccupiedTarget =
    job.targetContext.kind === "device"
      ? reserveTargetControl(job.targetContext.serial, job.id)
      : () => undefined;
  const finishEvidence = async () => {
    await stopRunEvidence(
      evidence,
      job,
      runEvidenceFinalizationDevice(job.status, device),
      pushLog,
    );
  };

  try {
    await cooperativeCheckpoint(id);

    if ((job.serial || job.browserTargetId) && target.deviceAvailable === false) {
      throw new Error(
        job.targetKind === "browser"
          ? `managed browser missing: ${job.browserTargetId}`
          : `device missing: ${job.serial} is no longer connected`,
      );
    }

    device = await acquirePreparedSessionDevice(job, target, pushLog);
    evidence = await startRunEvidence(job, device, pushLog, evidence, {
      physicalIos: target.physicalIos,
    });

    // Heartbeat: surface cancel even during long SDK calls; hard-stop session.
    const durableHeartbeat = workerInstanceId
      ? createDurableSessionHeartbeat(job.id, workerInstanceId)
      : undefined;
    let pendingCancel: Error | null = null;
    const heartbeat = setInterval(() => {
      try {
        durableHeartbeat?.();
        throwIfCancelled(id);
      } catch (err) {
        pendingCancel = err instanceof Error ? err : new Error(String(err));
        if (!compensatingCleanupIsArmed(id) && job.targetContext.kind === "device") {
          void hardStopDeviceSession(job.targetContext);
          resetDeviceClient(job.targetContext);
        }
      }
    }, 50);

    try {
      await runRecipeSteps(job, device, pushLog, (step) => {
        currentRecipeStep = step;
      });
      const failedChecks = failedCampaignChecks(job);
      if (failedChecks.length) {
        throw new Error(
          `${failedChecks.length} campaign ${failedChecks.length === 1 ? "check" : "checks"} failed: ${failedChecks
            .map((check) => `${check.title}: ${check.error}`)
            .join("; ")}`,
        );
      }
      if (pendingCancel) throw pendingCancel;
    } finally {
      clearInterval(heartbeat);
    }
    await cooperativeCheckpoint(id);
    await finishEvidence();

    job.finishedAt = now();

    const wasRetry = Boolean(job.retryOf && job.previousError);
    for (const step of job.steps) {
      if (step.status === "running" || !step.finishedAt) finishStep(step, "ok");
    }
    if (wasRetry) {
      job.status = "healed";
      job.healed = true;
      job.healMessage = `Recovered after failure: ${job.previousError}. Recipe re-ran successfully on attempt ${job.attempts}.`;
      job.tone = "heal";
      job.kind = "Healed";
      const last = job.steps.at(-1);
      if (last) {
        last.tone = "heal";
        last.kind = "Healed";
        last.heal = job.healMessage;
        finishStep(last, "healed", "✓ healed");
      }
    } else {
      job.status = "ok";
      const step = primary();
      if (step) finishStep(step, "ok", "✓ recipe completed");
    }
    job.result =
      job.review?.status === "pending" ? "recipe completed · needs review" : "recipe completed";
    job.error = undefined;
    job.errorCode = undefined;
    setOutcome(job);

    await commitTerminalRun(job, pushLog);
    if (job.status === "healed" && job.healMessage) {
      publish({
        type: "job.healed",
        at: job.finishedAt,
        jobId: job.id,
        action: job.action,
        healMessage: job.healMessage,
      });
    }
    publish({
      type: "job.finished",
      at: job.finishedAt,
      jobId: job.id,
      action: job.action,
      ok: job.outcome === "passed",
      result: job.result,
      error: job.error,
      durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
      healed: job.healed,
    });
  } catch (err) {
    if (isJobCancellation(err)) {
      pushLog("==> CANCELLED");
      for (const s of job.steps) {
        if (s.status === "running" || !s.finishedAt) finishStep(s, "error", "✗ cancelled");
      }
      finalizeCancelled(job, primary());
      // The terminal timestamp must exist before the buffered evidence
      // timeline closes, and cancellation must never query a hard-stopped
      // native session.
      await finishEvidence();
      await commitTerminalRun(job, pushLog);
      return;
    }
    if (
      err instanceof JobControlOwnershipError ||
      (err instanceof Error && err.name === "JobControlOwnershipError")
    ) {
      if (job.targetContext.kind === "device") {
        await hardStopDeviceSession(job.targetContext);
        resetDeviceClient(job.targetContext);
      }
    }
    await finishEvidence();
    const message = err instanceof Error ? err.message : String(err);
    job.finishedAt = now();
    job.status = "error";
    job.error = message;
    job.errorCode = classifySessionError(message);
    setOutcome(job);
    for (const s of job.steps) {
      if (s.status === "running" || !s.finishedAt) finishStep(s, "error");
    }
    const pe = primary();
    if (pe) finishStep(pe, "error", `✗ ${message}`);
    pushLog(`==> FAIL: ${message}`);
    publish({
      type: "job.finished",
      at: job.finishedAt,
      jobId: job.id,
      action: job.action,
      ok: false,
      error: message,
      durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
    });
    await commitTerminalRun(job, pushLog);
  } finally {
    try {
      await finishEvidence();
    } finally {
      if (job.targetKind === "browser" && job.browserTargetId) {
        // Proof contexts are one-shot and must never leak cookies, storage, or
        // service workers into the next Run. Authoring's persistent profile is
        // intentionally left open for the explicit target.open path.
        await closeBrowserTarget(job.browserTargetId, { mode: "proof" }).catch(() => undefined);
      }
      releaseOccupiedTarget();
      activeJobIds.delete(id);
      clearControl(id);
      jobRegistry.pruneTerminalHistory();
    }
  }
}

/** Attach a live screenshot (base64) to the active or given job + primary step. */
export async function attachJobFrame(opts: {
  jobId?: string;
  base64: string;
  caption: string;
  mime?: string;
}): Promise<TraceFrameRef | null> {
  if (!visualEvidenceAllowed()) return null;
  const job = opts.jobId ? jobRegistry.get(opts.jobId) : getActiveJob();
  if (!job) return null;
  const frame = await writeFramePng(job, opts.base64, opts.caption);
  const step = job.steps[job.steps.length - 1];
  if (step) {
    step.frames.push({ ...frame, base64: undefined });
    if (!step.glyphs.includes("shot")) {
      step.glyphs = [...step.glyphs, "shot" as Glyph].slice(0, 6);
    }
    const previous = step.actions?.at(-1);
    if (previous?.kind !== "shot" || frame.capturedAt - previous.at >= 250) {
      step.actions = [...(step.actions ?? []), { kind: "shot" as Glyph, at: frame.capturedAt }];
    }
  }
  publish({
    type: "job.frame",
    at: frame.capturedAt,
    jobId: job.id,
    frame: { ...frame },
  });
  return frame;
}

export async function runJobSync(input: EnqueueJobInput): Promise<TestJob> {
  const frozen =
    input.recipe && (!input.recipeSnapshot || !input.recipeGraph)
      ? await freezeRecipeExecution(input.recipe)
      : undefined;
  const job = enqueueJob({ ...input, ...frozen });
  return waitForJobCompletion(job.id);
}
