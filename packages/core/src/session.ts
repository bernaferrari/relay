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
import {
  glyphsFromLogLine,
  type Glyph,
  type TraceFrameRef,
  type TraceStep,
  type StepKind,
  type StepTone,
} from "./trace.js";
import { persistRun, writeFramePng, ensureRunDir } from "./runs.js";
import { classifyJobError } from "./report.js";
import {
  JobCancelledError,
  clearControl,
  ensureControl,
  requestCancel,
  requestPause,
  requestResume,
  runWithJobControl,
  cooperativeCheckpoint,
  throwIfCancelled,
  hardStopDeviceSession,
} from "./control.js";
import {
  readRecipe,
  freezeRecipeExecution,
  describeRecipeStep,
  glyphsForStep,
  type HumanCheckpointReason,
  type Recipe,
  type RecipeStep,
  type StepTarget,
} from "./recipes.js";
import { resolveRecipeStep, runRecipeStep } from "./recipe-runner.js";
import { redactPrivateValue } from "./private-inputs.js";
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
  type OperationContext,
} from "./operation-context.js";
import type {
  EvidenceCollectionPolicy,
  EvidenceManifest,
  FailureCategory,
  RunOutcome,
  RunReview,
  TargetProfile,
} from "@relay/protocol";
import type { JobSummary } from "@relay/protocol";
import { redactText, visualEvidenceAllowed } from "./redaction.js";
import { getEvidenceCollectionPolicy } from "./evidence-policy.js";
import { projectPersistedAppMapRun } from "./app-map-run-history.js";

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

export type JobStatus = "queued" | "running" | "paused" | "ok" | "error" | "healed" | "cancelled";

export type JobErrorCode =
  | "ACTION_FAILED"
  | "DEVICE_MISSING"
  | "UNKNOWN_ACTION"
  | "TIMEOUT"
  | "ACCOUNT_SWITCH_FAILED"
  | "CANCELLED"
  | "INTERNAL";

export type TestJob = {
  id: string;
  projectId?: string;
  ownerId?: string;
  operationContext?: OperationContext;
  /** Immutable execution target captured when the job is accepted. */
  targetContext: TargetContext;
  action: string;
  /** recipe id when this job runs a recipe (action == recipeId for naming) */
  recipeId?: string;
  serial?: string;
  /** Human device name from agent-device list */
  deviceName?: string;
  platform: DevicePlatform;
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  /** Frozen facts used to select this run from a compatibility matrix. */
  targetProfile?: TargetProfile;
  /** Scheduler provenance. Optional only when reading older persisted runs. */
  workerId?: string;
  workerCapacity?: number;
  status: JobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  result?: unknown;
  error?: string;
  errorCode?: JobErrorCode;
  outcome?: RunOutcome;
  failureCategory?: FailureCategory;
  /** A completed run whose final verdict is intentionally deferred to a human. */
  review?: RunReview;
  /** Optional app-under-test version if known from the action result. */
  appVersion?: string;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  /** prior failure message if this run self-healed via retry */
  previousError?: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  /** retries this job (or job this retries) */
  retryOf?: string;
  retriedBy?: string;
  steps: TraceStep[];
  frames: TraceFrameRef[];
  glyphs: Glyph[];
  kind: StepKind;
  tone: StepTone;
  title: string;
  runDir?: string;
  persisted?: boolean;
  /** Frozen authoring input and evidence payloads written once with the run. */
  recipeSnapshot?: Recipe;
  /** Complete immutable graph used by module, branch, and repeat steps. */
  recipeGraph?: Record<string, Recipe>;
  /** Structured completeness and ordered evidence timeline for this run. */
  evidence?: EvidenceManifest;
  /** Consent grants frozen before collectors start. */
  evidencePolicy: EvidenceCollectionPolicy;
  /** Present while a recipe is deliberately waiting for a person to act. */
  waitingFor?: {
    kind: "human";
    message: string;
    reason: HumanCheckpointReason;
    resumeLabel: string;
    since: number;
    timeoutMs?: number;
    verifyAfter?: {
      target: StepTarget;
      condition: "visible" | "gone";
      timeoutMs?: number;
    };
  };
  artifacts: { kind: string; capturedAt: number; data: unknown }[];
  resolvedInputs: Record<string, string>;
  /** Input names whose values are execution-only and must never cross a
   * transport or persistence boundary in plaintext. */
  sensitiveInputNames?: string[];
  options?: {
    prodAccountMatch?: string;
  };
};

const jobs = new Map<string, TestJob>();
const jobOrder: string[] = [];
const MAX_JOBS = 100;
const activeJobIds = new Set<string>();
const scheduler = new TargetWorkerScheduler();

export function listJobs(limit = 50): TestJob[] {
  return jobOrder
    .slice()
    .reverse()
    .slice(0, limit)
    .map((id) => jobs.get(id)!)
    .filter(Boolean);
}

function summarizeMatrixCase(data: unknown): JobSummary["matrixCase"] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const candidate = data as Record<string, unknown>;
  if (candidate.kind !== "combine" || typeof candidate.world !== "string") return undefined;
  if (
    !candidate.values ||
    typeof candidate.values !== "object" ||
    Array.isArray(candidate.values)
  ) {
    return undefined;
  }
  const values = Object.fromEntries(
    Object.entries(candidate.values).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    kind: "combine",
    ...(typeof candidate.combineId === "string" && candidate.combineId.trim()
      ? { combineId: candidate.combineId.trim() }
      : {}),
    world: candidate.world,
    values,
    ...(typeof candidate.expectedScreenshots === "number" &&
    Number.isFinite(candidate.expectedScreenshots)
      ? { expectedScreenshots: candidate.expectedScreenshots }
      : {}),
  };
}

export function summarizeJob(job: TestJob): JobSummary {
  const lastLogs = job.logs.slice(-12);
  const frozenInputs = job.artifacts.find((artifact) => artifact.kind === "frozen-inputs")?.data;
  const matrixCase = summarizeMatrixCase(frozenInputs);
  return {
    id: job.id,
    action: job.action,
    title: job.title,
    status: job.status,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs:
      job.finishedAt && (job.startedAt ?? job.queuedAt)
        ? job.finishedAt - (job.startedAt ?? job.queuedAt)
        : undefined,
    platform: job.targetKind === "browser" ? "browser" : job.platform,
    serial: job.browserTargetId ?? job.serial,
    outcome: job.outcome,
    review: job.review,
    batchId: job.batchId,
    caseIndex: job.caseIndex,
    caseCount: job.caseCount,
    ...(matrixCase ? { matrixCase } : {}),
    frameCount: job.frames.length,
    evidenceComplete: Boolean(job.evidence?.finishedAt),
    ...(lastLogs.length ? { lastLogs } : {}),
  };
}

export function getJob(id: string): TestJob | undefined {
  return jobs.get(id);
}

export function getActiveJobs(): TestJob[] {
  return [...activeJobIds].map((id) => jobs.get(id)).filter((job): job is TestJob => Boolean(job));
}

export function getActiveJob(targetId?: string): TestJob | null {
  const active = getActiveJobs();
  if (!targetId) return active.at(-1) ?? null;
  return active.find((job) => (job.browserTargetId ?? job.serial) === targetId) ?? null;
}

export function listTargetWorkers(): TargetWorkerStatus[] {
  return scheduler.statuses();
}

function remember(job: TestJob): void {
  jobs.set(job.id, job);
  jobOrder.push(job.id);
  while (jobOrder.length > MAX_JOBS) {
    const old = jobOrder.shift();
    if (old) jobs.delete(old);
  }
}

function setOutcome(job: TestJob): void {
  const classified = classifyRunOutcome(job);
  job.outcome = classified.outcome;
  job.failureCategory = classified.failureCategory;
}

export type EnqueueJobInput = {
  /** Internal executable recipe projection for a canonical App Map Flow. */
  recipe: string;
  serial?: string;
  platform?: DevicePlatform;
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  targetProfile?: TargetProfile;
  prodAccountMatch?: string;
  /** retry a failed job — enables heal if success */
  retryOf?: string;
  /** provisional title for recipe jobs (recipe id is used if absent) */
  title?: string;
  variables?: Record<string, string>;
  sensitiveInputNames?: string[];
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  artifacts?: TestJob["artifacts"];
  /** Frozen execution input. Matrix and retry jobs reuse this snapshot. */
  recipeSnapshot?: Recipe;
  recipeGraph?: Record<string, Recipe>;
  projectId?: string;
  ownerId?: string;
  evidencePolicy?: EvidenceCollectionPolicy;
  workerId?: string;
  workerCapacity?: number;
};

function makeJob(input: EnqueueJobInput, attemptSeed = 1): TestJob {
  const parent = input.retryOf ? jobs.get(input.retryOf) : undefined;
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
  if (input.retryOf) {
    const parent = jobs.get(input.retryOf);
    if (parent) parent.retriedBy = job.id;
  }
  remember(job);
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
      if (job.status === "cancelled") return;
      const execute = () =>
        runWithJobControl(job.id, () =>
          runWithTargetContext(job.targetContext, () => executeJob(job.id)),
        );
      if (job.operationContext) await runWithOperationContext(job.operationContext, execute);
      else await execute();
    },
  });
  return job;
}

/** Re-run a failed (or any) job — success after failure marks healed. */
export function retryJob(id: string): TestJob {
  const parent = jobs.get(id);
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
  const job = jobs.get(id);
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
    void persistRun(job).catch(() => undefined);
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
  const job = jobs.get(id);
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
  const job = jobs.get(id);
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
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === "cancelled") return;

  ensureControl(id);
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
  const job = opts.jobId ? jobs.get(opts.jobId) : getActiveJob();
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
  for (;;) {
    const current = getJob(job.id);
    if (!current) throw new Error("job vanished");
    if (
      current.status === "ok" ||
      current.status === "error" ||
      current.status === "healed" ||
      current.status === "cancelled"
    ) {
      return current;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
