/**
 * Test-run sessions with action traces, heal retries, and disk persistence.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { now, publish } from "./events.js";
import {
  base,
  createDevice,
  openApp,
  rememberedTargetApplication,
  resetDeviceClient,
  snapshot,
  type Device,
  type DevicePlatform,
} from "./device.js";
import { captureIosPngViaGoIos } from "./ios-app-launch.js";
import { inferDevicePlatformFromSerial } from "./target-context.js";
import { glyphsFromLogLine, type Glyph, type TraceFrameRef, type TraceStep } from "./trace.js";
import { persistRun, writeFramePng, ensureRunDir, type PersistedRun } from "./runs.js";
import { classifyJobError } from "./report.js";
import {
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
import {
  readRecipe,
  freezeRecipeExecution,
  describeRecipeStep,
  glyphsForStep,
  type RecipeStep,
} from "./recipes.js";
import { resolveRecipeStep, runRecipeStep } from "./recipe-runner.js";
import { PRIVATE_INPUT, redactPrivateValue } from "./private-inputs.js";
import { REDACTED } from "./redaction.js";
import { classifyRunOutcome } from "./outcomes.js";
import { inferIosSnapshotGeometry, normalizeScreenshotToBounds } from "./ios-geometry.js";
import {
  initializeRunEvidence,
  startRunEvidence,
  stopRunEvidence,
  type RunEvidenceHandle,
} from "./run-evidence.js";
import { getBrowserDevice } from "./browser-target.js";
import { preflightTarget, readTarget } from "./targets.js";
import { runWithTargetContext, type TargetContext } from "./target-context.js";
import {
  TargetWorkerScheduler,
  defaultTargetWorkerAssignment,
  type TargetWorkerStatus,
} from "./target-worker.js";
import {
  currentOperationContext,
  requireOperationContext,
  runWithOperationContext,
} from "./operation-context.js";
import { redactText, visualEvidenceAllowed } from "./redaction.js";
import { getEvidenceCollectionPolicy } from "./evidence-policy.js";
import { projectPersistedAppMapRun } from "./app-map-run-history.js";
import { JobRegistry } from "./job-registry.js";
import { isDeviceLeaseClaimActive } from "./collaboration.js";
import type { EnqueueJobInput, JobErrorCode, TestJob } from "./session-contract.js";
export type { EnqueueJobInput, JobErrorCode, JobStatus, TestJob } from "./session-contract.js";
export { summarizeJob } from "./session-summary.js";

function classifyError(message: string): JobErrorCode {
  return classifyJobError(message) as JobErrorCode;
}

/** Avoid importing workspace (session↔workspace cycle). */
async function resolveDeviceMeta(
  serial?: string,
  _platform?: DevicePlatform,
): Promise<{ deviceName?: string; deviceAvailable?: boolean; physicalIos?: boolean }> {
  if (!serial) return {};
  try {
    const client = createDevice();
    // Some SDK backends apply platform filters before normalizing attached
    // physical devices. Discover once, then match the canonical identifiers
    // ourselves so execution and the device picker cannot disagree.
    const devices = await client.devices.list();
    const match = devices.find((d) => {
      const s =
        d.android?.serial ?? d.ios?.udid ?? d.identifiers?.serial ?? d.identifiers?.udid ?? d.id;
      return s === serial || d.id === serial;
    });
    return {
      deviceName: match?.name,
      deviceAvailable: Boolean(match),
      physicalIos:
        _platform === "ios" && Boolean(match) && !/simulator|emulator/i.test(String(match?.kind)),
    };
  } catch {
    return {};
  }
}

const MAX_JOBS = 100;
const jobRegistry = new JobRegistry<TestJob>(MAX_JOBS);
const jobCompletions = new WeakMap<TestJob, { promise: Promise<void>; resolve: () => void }>();
const activeJobIds = new Set<string>();
const scheduler = new TargetWorkerScheduler();

export function listJobs(limit = 50): TestJob[] {
  return jobRegistry.list(limit);
}

export function getJob(id: string): TestJob | undefined {
  return jobRegistry.get(id);
}

/** Wait until the scheduled execution has fully drained, including its
 * terminal persistence attempt and lifecycle cleanup. A terminal status alone
 * is not this boundary: it is assigned before the terminal run is written. */
export async function waitForJobCompletion(id: string): Promise<TestJob> {
  const job = jobRegistry.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  const completion = jobCompletions.get(job);
  if (!completion) throw new Error(`Job ${id} has no execution lifecycle`);
  await completion.promise;
  return job;
}

export function getActiveJobs(): TestJob[] {
  return [...activeJobIds]
    .map((id) => jobRegistry.get(id))
    .filter((job): job is TestJob => Boolean(job));
}

export function getActiveJob(targetId?: string): TestJob | null {
  const active = getActiveJobs();
  if (!targetId) return active.at(-1) ?? null;
  return active.find((job) => (job.browserTargetId ?? job.serial) === targetId) ?? null;
}

export function listTargetWorkers(): TargetWorkerStatus[] {
  return scheduler.statuses();
}

function setOutcome(job: TestJob): void {
  const classified = classifyRunOutcome(job);
  job.outcome = classified.outcome;
  job.failureCategory = classified.failureCategory;
}

function jobLeaseValidator(job: TestJob): (() => Promise<void>) | undefined {
  const context = job.operationContext;
  if (job.targetContext.kind !== "device" || !context?.leaseId) return undefined;
  if (
    !context.projectId ||
    !context.actorId ||
    (job.projectId !== undefined && job.projectId !== context.projectId) ||
    (job.ownerId !== undefined && job.ownerId !== context.actorId)
  ) {
    return async () => {
      throw new JobControlOwnershipError();
    };
  }
  return async () => {
    const active = await isDeviceLeaseClaimActive({
      projectId: context.projectId,
      deviceSerial: job.targetContext.kind === "device" ? job.targetContext.serial : "",
      ownerId: context.actorId,
      leaseId: context.leaseId!,
    }).catch(() => false);
    if (!active) throw new JobControlOwnershipError();
  };
}

/**
 * Reconstruct the execution contract that was frozen with a completed run.
 *
 * A replay deliberately uses the recorded recipe graph instead of whatever a
 * map, test, or variable happens to look like today. That lets a person or an
 * agent answer “what exactly did we ask the device to do?” and repeat it
 * later, even after the server's in-memory job list has been restarted.
 *
 * Private inputs are never persisted, so this fails closed rather than
 * pretending a replay is equivalent while substituting redacted values.
 */
export function replayInputFromPersistedRun(
  run: Pick<
    PersistedRun,
    | "id"
    | "action"
    | "serial"
    | "platform"
    | "targetProfile"
    | "title"
    | "resolvedInputs"
    | "recipeSnapshot"
    | "recipeGraph"
    | "projectId"
    | "ownerId"
  >,
): EnqueueJobInput {
  if (!run.recipeSnapshot || !run.recipeGraph) {
    throw new Error("This run predates frozen replay data and cannot be replayed safely");
  }
  const unavailableInput = Object.entries(run.resolvedInputs).find(
    ([, value]) => value === PRIVATE_INPUT || value === REDACTED,
  );
  if (unavailableInput) {
    throw new Error(
      `This run used a private value for “${unavailableInput[0]}”. Provide it again before replaying.`,
    );
  }
  const platform =
    run.platform === "android" || run.platform === "ios" || run.platform === "browser"
      ? run.platform
      : undefined;
  const targetId = run.serial?.trim();
  if (!targetId || !platform) {
    throw new Error("This run has no reusable target identity and cannot be replayed safely");
  }
  return {
    recipe: run.action,
    ...(platform === "browser"
      ? { targetKind: "browser" as const, browserTargetId: targetId }
      : { targetKind: "device" as const, serial: targetId, platform }),
    targetProfile: run.targetProfile,
    title: `${run.title ?? run.action} · replay`,
    variables: structuredClone(run.resolvedInputs),
    recipeSnapshot: structuredClone(run.recipeSnapshot),
    recipeGraph: structuredClone(run.recipeGraph),
    projectId: run.projectId,
    ownerId: run.ownerId,
  };
}

/** Re-run an immutable persisted execution and preserve its source lineage. */
export function replayPersistedRun(run: PersistedRun): TestJob {
  return enqueueJob({ ...replayInputFromPersistedRun(run), retryOf: run.id });
}

function makeJob(input: EnqueueJobInput, attemptSeed = 1): TestJob {
  const parent = input.retryOf ? jobRegistry.get(input.retryOf) : undefined;
  const id = randomUUID();
  const targetKind = input.targetKind ?? parent?.targetKind ?? "device";
  const targetContext: TargetContext =
    targetKind === "browser"
      ? Object.freeze({
          kind: "browser" as const,
          platform: "browser" as const,
          targetId:
            input.browserTargetId?.trim() ||
            (parent?.targetContext.kind === "browser" ? parent.targetContext.targetId : "") ||
            input.serial?.trim() ||
            "",
        })
      : Object.freeze({
          kind: "device" as const,
          platform:
            input.platform ??
            parent?.platform ??
            inferDevicePlatformFromSerial(
              input.serial?.trim() ||
                (parent?.targetContext.kind === "device" ? parent.targetContext.serial : "") ||
                "",
            ) ??
            ("android" as const),
          serial:
            input.serial?.trim() ||
            (parent?.targetContext.kind === "device" ? parent.targetContext.serial : "") ||
            "",
        });
  const targetId = targetContext.kind === "browser" ? targetContext.targetId : targetContext.serial;
  if (!targetId) throw new Error("Every Relay job requires an explicit target");
  const operationContext = currentOperationContext() ?? parent?.operationContext;
  const assignment = defaultTargetWorkerAssignment({
    targetId,
    platform: targetContext.platform,
    workerId: input.workerId ?? parent?.workerId,
    workerCapacity: input.workerCapacity ?? parent?.workerCapacity,
  });
  const baseJob = {
    id,
    projectId: input.projectId ?? parent?.projectId,
    ownerId: input.ownerId ?? parent?.ownerId,
    operationContext: operationContext
      ? Object.freeze(structuredClone(operationContext))
      : undefined,
    targetContext,
    serial: targetContext.kind === "device" ? targetContext.serial : undefined,
    deviceName: parent?.deviceName,
    platform: targetContext.kind === "device" ? targetContext.platform : ("android" as const),
    targetKind,
    browserTargetId: targetContext.kind === "browser" ? targetContext.targetId : undefined,
    targetProfile: input.targetProfile ?? parent?.targetProfile,
    workerId: assignment.workerId,
    workerCapacity: assignment.capacity,
    status: "queued" as const,
    queuedAt: now(),
    logs: [] as string[],
    attempts: parent ? parent.attempts + 1 : attemptSeed,
    retryOf: input.retryOf,
    previousError: parent?.error ?? parent?.previousError,
    steps: [] as TraceStep[],
    frames: [] as TraceFrameRef[],
    artifacts: [...(input.artifacts ?? [])] as {
      kind: string;
      capturedAt: number;
      data: unknown;
    }[],
    batchId: input.batchId ?? parent?.batchId,
    caseIndex: input.caseIndex ?? parent?.caseIndex,
    caseCount: input.caseCount ?? parent?.caseCount,
    resolvedInputs: Object.assign({}, parent?.resolvedInputs ?? input.variables),
    sensitiveInputNames: [
      ...new Set(parent?.sensitiveInputNames ?? input.sensitiveInputNames ?? []),
    ].sort((left, right) => left.localeCompare(right)),
    recipeSnapshot: structuredClone(input.recipeSnapshot ?? parent?.recipeSnapshot),
    recipeGraph: structuredClone(input.recipeGraph ?? parent?.recipeGraph),
    evidencePolicy: structuredClone(
      input.evidencePolicy ?? parent?.evidencePolicy ?? getEvidenceCollectionPolicy(),
    ),
    options: {
      prodAccountMatch: input.prodAccountMatch ?? parent?.options?.prodAccountMatch,
    },
  };

  // `action` remains the report/event label; every execution itself is a frozen recipe.
  const recipeId = input.recipe;
  const job: TestJob = {
    ...baseJob,
    action: recipeId,
    recipeId,
    glyphs: ["ai", "wait"],
    kind: "Replay",
    tone: "acc",
    title: input.title ?? recipeId,
  };
  Object.defineProperty(job, "toJSON", {
    enumerable: false,
    value: () => jobForTransport(job),
  });
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

export function enqueueJob(input: EnqueueJobInput): TestJob {
  requireOperationContext();
  const job = makeJob(input);
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  jobCompletions.set(job, { promise: completion, resolve: resolveCompletion });
  if (input.retryOf) {
    const parent = jobRegistry.get(input.retryOf);
    if (parent) parent.retriedBy = job.id;
  }
  jobRegistry.remember(job);
  publish({
    type: "job.queued",
    at: job.queuedAt,
    jobId: job.id,
    action: job.action,
    serial: job.serial,
  });
  scheduler.enqueue({
    id: job.id,
    workerId: job.workerId!,
    targetId: job.browserTargetId ?? job.serial!,
    capacity: job.workerCapacity!,
    run: async () => {
      try {
        if (job.status === "cancelled") return;
        const execute = () =>
          runWithJobControl(job.id, () =>
            runWithTargetContext(job.targetContext, () => executeJob(job.id)),
          );
        if (job.operationContext) await runWithOperationContext(job.operationContext, execute);
        else await execute();
      } finally {
        resolveCompletion();
      }
    },
  });
  return job;
}

/** Re-run a failed (or any) job — success after failure marks healed. */
export function retryJob(id: string): TestJob {
  const parent = jobRegistry.get(id);
  if (!parent) throw new Error(`Unknown job: ${id}`);
  return enqueueJob({
    recipe: parent.recipeId!,
    serial: parent.serial,
    platform: parent.platform,
    prodAccountMatch: parent.options?.prodAccountMatch,
    retryOf: parent.id,
    title: parent.title,
    variables: parent.resolvedInputs,
    sensitiveInputNames: parent.sensitiveInputNames ?? [],
    recipeSnapshot: parent.recipeSnapshot,
    recipeGraph: parent.recipeGraph,
    batchId: parent.batchId,
    caseIndex: parent.caseIndex,
    caseCount: parent.caseCount,
    targetKind: parent.targetKind,
    browserTargetId: parent.browserTargetId,
    targetProfile: parent.targetProfile,
    workerId: parent.workerId,
    workerCapacity: parent.workerCapacity,
    artifacts: parent.artifacts,
    projectId: parent.projectId,
    ownerId: parent.ownerId,
  });
}

async function persistCompletedRun(job: TestJob, log: (line: string) => void): Promise<void> {
  try {
    const persisted = await persistRun(job);
    await projectPersistedAppMapRun(persisted).catch((error) =>
      log(
        `warn: App Map run projection failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  } catch (error) {
    log(`warn: persist run failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function openStep(
  job: TestJob,
  partial: Omit<TraceStep, "id" | "index" | "startedAt" | "frames" | "log"> & {
    log?: string;
    frames?: TraceFrameRef[];
  },
): TraceStep {
  const step: TraceStep = {
    id: randomUUID(),
    index: job.steps.length,
    kind: partial.kind,
    tone: partial.tone,
    title: partial.title,
    glyphs: partial.glyphs,
    startedAt: now(),
    frames: partial.frames ?? [],
    log: partial.log ?? "",
    heal: partial.heal,
    status: partial.status ?? "running",
    // `glyphs` describes the plan; `actions` is an ordered observation log.
    // Keeping the empty array is intentional: old traces omit the field and
    // may fall back to glyphs, while new traces never present plans as facts.
    actions: [],
  };
  job.steps.push(step);
  publish({
    type: "job.step",
    at: step.startedAt,
    jobId: job.id,
    step,
  });
  return step;
}

function finishStep(step: TraceStep, status: TraceStep["status"], extraLog?: string): void {
  step.finishedAt = now();
  step.durationMs = step.finishedAt - step.startedAt;
  step.status = status;
  if (extraLog) step.log = step.log ? `${step.log}\n${extraLog}` : extraLog;
}

function appendStepLog(step: TraceStep | undefined, line: string): void {
  if (!step) return;
  step.log = step.log ? `${step.log}\n${line}` : line;
  // enrich glyphs from live logs
  const inferred = glyphsFromLogLine(line);
  step.glyphs = [...new Set([...step.glyphs, ...inferred])].slice(0, 6);
  if (inferred.length > 0) {
    const at = now();
    const actions = step.actions ?? [];
    for (const kind of inferred) {
      const previous = actions.at(-1);
      if (previous?.kind === kind && at - previous.at < 250) continue;
      actions.push({ kind, at, label: line });
    }
    step.actions = actions;
  }
}

function observeStepActions(step: TraceStep, glyphs: Glyph[]): void {
  const at = now();
  step.actions = [...(step.actions ?? []), ...glyphs.map((kind) => ({ kind, at }))];
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

/**
 * Cancel a queued or in-flight job.
 * Flags cancel immediately and hard-stops the agent-device session so in-flight
 * ADB work is more likely to drop (best-effort).
 */
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
  if (job.status === "running" || job.status === "paused") {
    void hardStopDeviceSession(job.targetContext);
    resetDeviceClient(job.targetContext);
  }

  if (job.status === "queued") {
    scheduler.remove(id);
    job.startedAt = job.startedAt ?? now();
    finalizeCancelled(job);
    void persistRun(job)
      .then(() => jobRegistry.pruneTerminalHistory())
      .catch(() => undefined)
      .finally(() => jobCompletions.get(job)?.resolve());
    clearControl(id);
    return job;
  }

  job.logs.push("==> cancel requested (hard-stop session)");
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: "==> cancel requested (hard-stop session)",
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

/** Resume a paused job. */
export function resumeJob(id: string): TestJob {
  const job = jobRegistry.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  if (job.status !== "paused") {
    throw new Error(`Cannot resume job in status ${job.status}`);
  }
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

export function automaticEvidencePhases(step: RecipeStep): readonly ("before" | "after")[] {
  switch (step.kind) {
    // These steps already produce their own evidence or only orchestrate
    // nested steps. Capturing two additional device states adds latency and
    // duplicate frames without improving diagnosis.
    case "sleep":
    case "screenshot":
    case "tour":
    case "logs":
    case "network":
    case "script":
    case "flow":
    case "module":
    case "repeat":
    case "branch":
      return [];
    case "app":
      // A matrix's locale/open wrapper is followed by an explicit mapped
      // screen assertion and screenshot. Capturing both sides here duplicates
      // that evidence, costs two full tree+raster reads per world, and makes a
      // simple one-cold-start traversal look like repeated app restarts. Keep
      // the command attempt and its failure frame; mapped destinations remain
      // the canonical visual evidence.
      if (step.action === "open" || step.action === "set-locale") return [];
      return ["after"];
    case "device":
      // Keyboard dismissal is setup noise. The next mapped assertion captures
      // the settled application surface; failures still receive a frame.
      if (step.action === "keyboard-dismiss") return [];
      return ["after"];
    // Assertions and waits need the resulting state, not an identical frame
    // before the check. Interaction steps retain both sides of the causal
    // boundary.
    case "expect":
    case "expect-screen":
    case "assert-content":
    case "extract":
    case "evaluate-semantic":
    case "wait-for":
    case "wait-response":
    case "pause":
    case "review":
      return ["after"];
    default:
      return ["before", "after"];
  }
}

/**
 * Load the frozen recipe and run each action as a real TraceStep. Cancel
 * propagates from device ops (controlled/raceCancel) and is rethrown so the
 * shared catch path finalizes the job. `setCurrentStep` routes per-step logs.
 */
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
  pushLog(`==> recipe: ${recipe.title} · ${recipe.steps.length} step(s)`);
  for (const step of recipe.steps) {
    await cooperativeCheckpoint(job.id);
    const ts = openStep(job, {
      kind: "Replay",
      tone: "acc",
      title: describeRecipeStep(step),
      glyphs: glyphsForStep(step),
      status: "running",
    });
    setCurrentStep(ts);
    try {
      // The command is now being attempted. Record it here—not when the plan
      // was created—so the timeline distinguishes intent from observation.
      observeStepActions(ts, glyphsForStep(step));
      const resolvedStep = resolveRecipeStep(step, job.resolvedInputs);
      job.artifacts.push({
        kind: "command-attempt",
        capturedAt: now(),
        data: { stepId: ts.id, command: resolvedStep },
      });
      const evidencePhases = automaticEvidencePhases(resolvedStep);
      if (evidencePhases.includes("before"))
        await captureAutomaticState(job, device, ts, "before", pushLog);
      await runRecipeStep(device, resolvedStep, {
        log: pushLog,
        job,
        recipeGraph: job.recipeGraph,
      });
      if (evidencePhases.includes("after"))
        await captureAutomaticState(job, device, ts, "after", pushLog);
      finishStep(ts, "ok");
    } catch (err) {
      // A failure frame is always useful, including when the normal policy
      // suppresses redundant evidence for a passive step.
      await captureAutomaticState(job, device, ts, "after", pushLog);
      finishStep(ts, "error", `✗ ${err instanceof Error ? err.message : String(err)}`);
      setCurrentStep(undefined);
      throw err;
    }
  }
  setCurrentStep(undefined);
}

async function captureAutomaticState(
  job: TestJob,
  device: Device,
  step: TraceStep,
  phase: "before" | "after",
  log: (line: string) => void,
): Promise<void> {
  if (process.env.RELAY_AUTO_VISUAL_EVIDENCE === "0") return;
  if (!visualEvidenceAllowed()) return;
  let snapshotNodes: import("./device.js").SnapshotNode[] | undefined;
  try {
    snapshotNodes = await snapshot(device);
    job.artifacts.push({
      kind: "ui-tree",
      capturedAt: now(),
      data: { stepId: step.id, phase, nodes: snapshotNodes },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job.platform === "ios" && /session|open first/i.test(message)) {
      if (!job.logs.some((line) => line.includes("accessibility tree unavailable"))) {
        log("warn: iOS accessibility tree unavailable — collecting screenshots from pixels");
      }
    } else {
      log(`warn: ${phase} UI-tree capture failed: ${message}`);
    }
  }

  const runDir = await ensureRunDir(job);
  await mkdir(join(runDir, "frames"), { recursive: true });
  const temporary = join(runDir, "frames", `.capture-${randomUUID()}.png`);
  try {
    let bytes: Buffer;
    if (job.platform === "ios" && job.serial) {
      try {
        await captureIosPngViaGoIos(job.serial, temporary);
        bytes = await readFile(temporary);
      } catch {
        const result = await device.capture.screenshot({ ...base(), path: temporary });
        bytes = result.base64 ? Buffer.from(result.base64, "base64") : await readFile(temporary);
      }
    } else {
      const result = await device.capture.screenshot({ ...base(), path: temporary });
      bytes = result.base64 ? Buffer.from(result.base64, "base64") : await readFile(temporary);
    }
    if (job.platform === "ios") {
      const geometry = snapshotNodes ? inferIosSnapshotGeometry(snapshotNodes) : undefined;
      const bounds = geometry
        ? { width: geometry.logicalWidth, height: geometry.logicalHeight }
        : undefined;
      const orientation =
        bounds && bounds.width > bounds.height
          ? "landscape-right"
          : bounds && bounds.height > bounds.width
            ? "portrait"
            : bytes.length > 24 && bytes.readUInt32BE(16) > bytes.readUInt32BE(20)
              ? "landscape-right"
              : "portrait";
      bytes = normalizeScreenshotToBounds(bytes, bounds, orientation);
    }
    const encoded = bytes.toString("base64");
    const frame = await writeFramePng(job, encoded, `${phase} · ${step.title}`);
    step.frames.push({ ...frame, base64: undefined });
  } catch (error) {
    log(
      `warn: ${phase} screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function executeJob(id: string): Promise<void> {
  const job = jobRegistry.get(id);
  if (!job) {
    const message = `Job registry invariant violated: scheduled job ${id} is missing`;
    publish({ type: "error", at: now(), message, where: "session.executeJob" });
    throw new Error(message);
  }
  if (job.status === "cancelled") return;

  ensureControl(id);
  const validateLease = jobLeaseValidator(job);
  if (validateLease) {
    setControlValidator(id, validateLease);
    try {
      await cooperativeCheckpoint(id);
    } catch (error) {
      job.startedAt = now();
      if (
        error instanceof JobCancelledError ||
        (error instanceof Error && error.name === "JobCancelledError")
      ) {
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
        job.errorCode = classifyError(message);
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
      await persistCompletedRun(job, (line) => job.logs.push(line));
      clearControl(id);
      jobRegistry.pruneTerminalHistory();
      return;
    }
  }
  activeJobIds.add(id);
  job.status = "running";
  job.startedAt = now();
  const browserTarget = job.browserTargetId ? await readTarget(job.browserTargetId) : null;
  const meta =
    job.targetKind === "browser"
      ? { deviceName: browserTarget?.name, deviceAvailable: Boolean(browserTarget) }
      : await resolveDeviceMeta(job.serial, job.platform);
  if (meta.deviceName) job.deviceName = meta.deviceName;
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
  const finishEvidence = async () => {
    await stopRunEvidence(evidence, job, device, pushLog);
  };

  try {
    await cooperativeCheckpoint(id);

    if ((job.serial || job.browserTargetId) && meta.deviceAvailable === false) {
      throw new Error(
        job.targetKind === "browser"
          ? `managed browser missing: ${job.browserTargetId}`
          : `device missing: ${job.serial} is no longer connected`,
      );
    }

    if (job.targetKind === "browser" && browserTarget) {
      const preflight = await preflightTarget(browserTarget);
      job.artifacts.push({ kind: "target-preflight", capturedAt: now(), data: preflight });
      if (!preflight.ok) {
        const failures = preflight.checks
          .filter((check) => check.status === "fail")
          .map((check) => check.message)
          .join("; ");
        throw new Error(`environment preflight failed: ${failures}`);
      }
      device = await getBrowserDevice(browserTarget.id);
    } else {
      // A physical iOS target uses one long-lived XCTest process. Stopping it
      // here backgrounds the app immediately before source verification and
      // turns a valid map run into a tap on SpringBoard. Simulators and Android
      // still benefit from releasing stale bindings between jobs.
      if (!meta.physicalIos) {
        await hardStopDeviceSession(job.targetContext);
        resetDeviceClient(job.targetContext);
      }
      device = createDevice();
      if (job.platform === "ios" && job.serial) {
        const app = await rememberedTargetApplication(job.targetContext);
        if (app) {
          pushLog(`session: prime ${app} without relaunch`);
          await openApp(device, app, { relaunch: false }).catch((error) => {
            pushLog(
              `warn: iOS session still unbound (${error instanceof Error ? error.message : String(error)}) — continuing with pixels`,
            );
          });
        }
      }
    }
    evidence = await startRunEvidence(job, device, pushLog, evidence, {
      physicalIos: meta.physicalIos,
    });

    // Heartbeat: surface cancel even during long SDK calls; hard-stop session
    let pendingCancel: Error | null = null;
    const heartbeat = setInterval(() => {
      try {
        throwIfCancelled(id);
      } catch (err) {
        pendingCancel = err instanceof Error ? err : new Error(String(err));
        void hardStopDeviceSession(job.targetContext);
        resetDeviceClient(job.targetContext);
      }
    }, 50);

    try {
      await runRecipeSteps(job, device, pushLog, (step) => {
        currentRecipeStep = step;
      });
      const failedChecks = job.artifacts.flatMap((artifact) => {
        if (
          artifact.kind !== "campaign-check-result" ||
          !artifact.data ||
          typeof artifact.data !== "object"
        ) {
          return [];
        }
        const data = artifact.data as Record<string, unknown>;
        return data.status === "failed" && typeof data.title === "string"
          ? [{ title: data.title, error: typeof data.error === "string" ? data.error : "failed" }]
          : [];
      });
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
      publish({
        type: "job.healed",
        at: job.finishedAt,
        jobId: job.id,
        action: job.action,
        healMessage: job.healMessage,
      });
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

    await persistCompletedRun(job, pushLog);
  } catch (err) {
    if (
      err instanceof JobCancelledError ||
      (err instanceof Error && err.name === "JobCancelledError")
    ) {
      await finishEvidence();
      pushLog("==> CANCELLED");
      for (const s of job.steps) {
        if (s.status === "running" || !s.finishedAt) finishStep(s, "error", "✗ cancelled");
      }
      finalizeCancelled(job, primary());
      await persistCompletedRun(job, pushLog);
      return;
    }
    if (
      err instanceof JobControlOwnershipError ||
      (err instanceof Error && err.name === "JobControlOwnershipError")
    ) {
      await hardStopDeviceSession(job.targetContext);
      resetDeviceClient(job.targetContext);
    }
    await finishEvidence();
    const message = err instanceof Error ? err.message : String(err);
    job.finishedAt = now();
    job.status = "error";
    job.error = message;
    job.errorCode = classifyError(message);
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
    await persistCompletedRun(job, pushLog);
  } finally {
    await finishEvidence();
    activeJobIds.delete(id);
    clearControl(id);
    jobRegistry.pruneTerminalHistory();
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
