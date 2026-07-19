/**
 * Test-run sessions with action traces, heal retries, and disk persistence.
 */
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { now, publish } from "./events.js";
import {
  getAction,
  isActionId,
  runAction,
  type RunActionOptions,
  type RunActionResult,
} from "./actions.js";
import { base, createDevice, type Device, type DevicePlatform } from "./device.js";
import {
  glyphsFromLogLine,
  planForAction,
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
  setExecutingJobId,
  cooperativeCheckpoint,
  throwIfCancelled,
  raceCancel,
  hardStopDeviceSession,
} from "./control.js";
import {
  readRecipe,
  describeRecipeStep,
  glyphsForStep,
  type HumanCheckpointReason,
  type Recipe,
  type StepTarget,
} from "./recipes.js";
import { resolveRecipeStep, runRecipeStep } from "./recipe-runner.js";
import { classifyRunOutcome } from "./outcomes.js";
import {
  initializeRunEvidence,
  startRunEvidence,
  stopRunEvidence,
  type RunEvidenceHandle,
} from "./run-evidence.js";
import { getBrowserDevice } from "./browser-target.js";
import { preflightTarget, readTarget } from "./targets.js";
import { runWithTargetContext, type TargetContext } from "./target-context.js";
import type {
  EvidenceCollectionPolicy,
  EvidenceManifest,
  FailureCategory,
  RunOutcome,
  TargetProfile,
} from "@relay/protocol";
import type { JobSummary } from "@relay/protocol";
import { redactText } from "./redaction.js";
import { getEvidenceCollectionPolicy } from "./evidence-policy.js";

function classifyError(message: string): JobErrorCode {
  return classifyJobError(message) as JobErrorCode;
}

/** Avoid importing workspace (session↔workspace cycle). */
async function resolveDeviceMeta(
  serial?: string,
  platform?: DevicePlatform,
): Promise<{ deviceName?: string; deviceAvailable?: boolean }> {
  if (!serial) return {};
  try {
    const client = createDevice();
    const devices = await client.devices.list(platform ? { platform } : undefined);
    const match = devices.find((d) => {
      const s =
        d.android?.serial ?? d.ios?.udid ?? d.identifiers?.serial ?? d.identifiers?.udid ?? d.id;
      return s === serial || d.id === serial;
    });
    return { deviceName: match?.name, deviceAvailable: Boolean(match) };
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
  options?: {
    prodAccountMatch?: string;
  };
};

const jobs = new Map<string, TestJob>();
const jobOrder: string[] = [];
const MAX_JOBS = 100;
let activeJobId: string | null = null;
const queue: string[] = [];
let draining = false;

export function listJobs(limit = 50): TestJob[] {
  return jobOrder
    .slice()
    .reverse()
    .slice(0, limit)
    .map((id) => jobs.get(id)!)
    .filter(Boolean);
}

export function summarizeJob(job: TestJob): JobSummary {
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
    batchId: job.batchId,
    frameCount: job.frames.length,
    evidenceComplete: Boolean(job.evidence?.finishedAt),
  };
}

export function getJob(id: string): TestJob | undefined {
  return jobs.get(id);
}

export function getActiveJob(): TestJob | null {
  return activeJobId ? (jobs.get(activeJobId) ?? null) : null;
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
  /** legacy coded action id (mutually exclusive with `recipe`) */
  action?: string;
  /** recipe id — runs a JSON recipe instead of a coded action */
  recipe?: string;
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
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  artifacts?: TestJob["artifacts"];
  /** Frozen execution input. Suite and retry jobs must provide/reuse this snapshot. */
  recipeSnapshot?: Recipe;
  projectId?: string;
  ownerId?: string;
  evidencePolicy?: EvidenceCollectionPolicy;
};

function makeJob(input: EnqueueJobInput, attemptSeed = 1): TestJob {
  const parent = input.retryOf ? jobs.get(input.retryOf) : undefined;
  const id = randomUUID();
  const baseJob = {
    id,
    projectId: input.projectId ?? parent?.projectId,
    ownerId: input.ownerId ?? parent?.ownerId,
    serial: input.serial?.trim() || parent?.serial || undefined,
    deviceName: parent?.deviceName,
    platform: input.platform ?? parent?.platform ?? ("android" as const),
    targetKind: input.targetKind ?? parent?.targetKind ?? "device",
    browserTargetId: input.browserTargetId ?? parent?.browserTargetId,
    targetProfile: input.targetProfile ?? parent?.targetProfile,
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
    recipeSnapshot: structuredClone(input.recipeSnapshot ?? parent?.recipeSnapshot),
    evidencePolicy: structuredClone(
      input.evidencePolicy ?? parent?.evidencePolicy ?? getEvidenceCollectionPolicy(),
    ),
    options: {
      prodAccountMatch: input.prodAccountMatch ?? parent?.options?.prodAccountMatch,
    },
  };

  // Recipe job: action doubles as the recipe id so history/run-dir naming keeps working.
  // The recipe is resolved (title/steps) inside executeJob; enqueue stays sync.
  if (input.recipe) {
    const recipeId = input.recipe;
    return {
      ...baseJob,
      action: recipeId,
      recipeId,
      glyphs: ["ai", "wait"],
      kind: "Replay",
      tone: "acc",
      title: input.title ?? recipeId,
    };
  }

  // Legacy coded-action job
  const action = input.action;
  if (!action || !isActionId(action)) {
    throw new Error(`Unknown action: ${action ?? "(none)"}`);
  }
  const plan = planForAction(action);
  const meta = getAction(action);
  return {
    ...baseJob,
    action,
    glyphs: plan.glyphs,
    kind: plan.kind,
    tone: plan.tone,
    title: meta?.title ?? action,
  };
}

export function enqueueJob(input: EnqueueJobInput): TestJob {
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
  queue.push(job.id);
  void drainQueue();
  return job;
}

/** Re-run a failed (or any) job — success after failure marks healed. */
export function retryJob(id: string): TestJob {
  const parent = jobs.get(id);
  if (!parent) throw new Error(`Unknown job: ${id}`);
  return enqueueJob({
    action: parent.recipeId ? undefined : parent.action,
    recipe: parent.recipeId,
    serial: parent.serial,
    platform: parent.platform,
    prodAccountMatch: parent.options?.prodAccountMatch,
    retryOf: parent.id,
    title: parent.title,
    variables: parent.resolvedInputs,
    recipeSnapshot: parent.recipeSnapshot,
    batchId: parent.batchId,
    caseIndex: parent.caseIndex,
    caseCount: parent.caseCount,
  });
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

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      // skipped if cancelled while still queued
      if (!job || job.status === "cancelled") continue;
      const context: TargetContext =
        job.targetKind === "browser" && job.browserTargetId
          ? { kind: "browser", platform: "browser", targetId: job.browserTargetId }
          : {
              kind: "device",
              platform: job.platform,
              ...(job.serial ? { serial: job.serial } : {}),
            };
      await runWithTargetContext(context, () => executeJob(id));
    }
  } finally {
    draining = false;
  }
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
    void hardStopDeviceSession();
  }

  if (job.status === "queued") {
    const idx = queue.indexOf(id);
    if (idx >= 0) queue.splice(idx, 1);
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
    line: "==> paused (Esc/Cancel still works)",
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
export function cancelActiveJob(): TestJob | null {
  const active = getActiveJob();
  if (!active) return null;
  return cancelJob(active.id);
}

/** Legacy coded-action path: dispatch to runAction under cancel race. */
async function runLegacyAction(
  job: TestJob,
  device: Device,
  pushLog: (line: string) => void,
): Promise<RunActionResult> {
  // makeJob guarantees legacy jobs carry a valid ActionId; narrow to satisfy types.
  if (!isActionId(job.action)) {
    throw new Error(`not a legacy action: ${job.action}`);
  }
  const opts: RunActionOptions = {
    onLog: (line) => {
      throwIfCancelled(job.id);
      pushLog(line);
    },
  };
  return await raceCancel(runAction(device, job.action, opts), job.id);
}

/**
 * Recipe path: load the recipe, run each step as a real TraceStep. Cancel
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
      await captureAutomaticState(job, device, ts, "before", pushLog);
      await runRecipeStep(device, resolvedStep, {
        log: pushLog,
        job,
      });
      await captureAutomaticState(job, device, ts, "after", pushLog);
      finishStep(ts, "ok");
    } catch (err) {
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
  try {
    const snapshot = await device.capture.snapshot({ ...base(), interactiveOnly: false });
    job.artifacts.push({
      kind: "ui-tree",
      capturedAt: now(),
      data: { stepId: step.id, phase, nodes: snapshot.nodes ?? [] },
    });
  } catch (error) {
    log(
      `warn: ${phase} UI-tree capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const runDir = await ensureRunDir(job);
  const temporary = join(runDir, "frames", `.capture-${randomUUID()}.png`);
  try {
    const result = await device.capture.screenshot({ ...base(), path: temporary });
    const encoded = result.base64 ?? (await readFile(temporary)).toString("base64");
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
  setExecutingJobId(id);
  activeJobId = id;
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

  // Target identity is carried by AsyncLocalStorage through drainQueue. The
  // account match remains a legacy action option and is restored below.
  const savedProdMatch = process.env.PROD_ACCOUNT_MATCH;
  if (job.options?.prodAccountMatch?.trim()) {
    process.env.PROD_ACCOUNT_MATCH = job.options.prodAccountMatch.trim();
  }

  const isRecipeJob = Boolean(job.recipeId);

  // Legacy jobs build cosmetic phase steps advanced by log-line regexes.
  // Recipe jobs open real TraceSteps one-per-step in runRecipeSteps.
  const plan = planForAction(job.action);
  const stepKind = job.retryOf ? ("Healed" as const) : plan.kind;
  const stepTone = job.retryOf ? ("heal" as const) : plan.tone;
  const phaseSpecs =
    !isRecipeJob && plan.planned.length > 0
      ? plan.planned
      : !isRecipeJob
        ? [{ title: job.title, glyphs: plan.glyphs as Glyph[] }]
        : [];

  const phaseSteps: TraceStep[] = phaseSpecs.map((p, i) =>
    openStep(job, {
      kind: stepKind,
      tone: stepTone,
      title: p.title,
      glyphs: (job.retryOf && i === 0 ? (["re", ...p.glyphs] as Glyph[]) : p.glyphs) as Glyph[],
      status: i === 0 ? "running" : undefined,
      log:
        i === 0
          ? job.retryOf
            ? `retry of ${job.retryOf.slice(0, 8)} · attempt ${job.attempts}`
            : `start ${job.action}${job.deviceName ? ` · ${job.deviceName}` : ""}${job.serial ? ` (${job.serial})` : ""}`
          : "",
    }),
  );

  let phaseIdx = 0;
  let currentRecipeStep: TraceStep | undefined;
  const currentPhase = () => phaseSteps[Math.min(phaseIdx, phaseSteps.length - 1)];
  const logTarget = () => (phaseSteps.length > 0 ? currentPhase() : currentRecipeStep);

  const pushLog = (line: string) => {
    const safeLine = redactText(line);
    job.logs.push(safeLine);
    appendStepLog(logTarget(), safeLine);
    // Advance phase on major progress markers so pause has clearer boundaries (legacy only)
    if (
      phaseSteps.length > 0 &&
      phaseIdx < phaseSteps.length - 1 &&
      (safeLine.startsWith("==>") ||
        /ensure|restore|update|install|login|sign out|chooser/i.test(safeLine))
    ) {
      const cur = phaseSteps[phaseIdx];
      if (cur && cur.status === "running") {
        finishStep(cur, "ok", safeLine);
        phaseIdx += 1;
        const next = phaseSteps[phaseIdx];
        if (next) next.status = "running";
      }
    }
    const level = /FAIL|error|Error|cancel/i.test(safeLine)
      ? ("error" as const)
      : /DONE|success|resumed|paused/i.test(safeLine)
        ? ("success" as const)
        : ("info" as const);
    publish({ type: "job.log", at: now(), jobId: job.id, line: safeLine, level });
  };

  const primary = () => currentPhase() ?? currentRecipeStep ?? job.steps[job.steps.length - 1];
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
      // Release stale mobile bindings so this job can bind cleanly.
      await hardStopDeviceSession();
      device = createDevice();
    }
    evidence = await startRunEvidence(job, device, pushLog, evidence);

    // Heartbeat: surface cancel even during long SDK calls; hard-stop session
    let pendingCancel: Error | null = null;
    const heartbeat = setInterval(() => {
      try {
        throwIfCancelled(id);
      } catch (err) {
        pendingCancel = err instanceof Error ? err : new Error(String(err));
        void hardStopDeviceSession();
      }
    }, 50);

    let result: { ok: boolean; result?: unknown; error?: string };
    try {
      if (isRecipeJob) {
        await runRecipeSteps(job, device, pushLog, (s) => {
          currentRecipeStep = s;
        });
        result = { ok: true, result: "recipe completed" };
      } else {
        result = await runLegacyAction(job, device, pushLog);
      }
      if (pendingCancel) throw pendingCancel;
    } finally {
      clearInterval(heartbeat);
    }
    await cooperativeCheckpoint(id);
    await finishEvidence();

    job.finishedAt = now();

    if (result.ok) {
      const wasRetry = Boolean(job.retryOf && job.previousError);
      // close any open steps as ok (legacy phases + recipe steps alike)
      for (const s of job.steps) {
        if (s.status === "running" || !s.finishedAt) finishStep(s, "ok");
      }
      if (wasRetry) {
        job.status = "healed";
        job.healed = true;
        job.healMessage = `Recovered after failure: ${job.previousError}. Recipe re-ran successfully on attempt ${job.attempts}.`;
        job.tone = "heal";
        job.kind = "Healed";
        const last = job.steps[job.steps.length - 1];
        if (last) {
          last.tone = "heal";
          last.kind = "Healed";
          last.heal = job.healMessage;
          finishStep(last, "healed", `✓ healed · ${result.result ?? "ok"}`);
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
        const p = primary();
        if (p) finishStep(p, "ok", `✓ ${result.result ?? "ok"}`);
      }
      job.result = result.result;
      job.error = undefined;
      job.errorCode = undefined;
      setOutcome(job);
    } else {
      job.status = "error";
      job.error = result.error;
      job.errorCode = classifyError(result.error ?? "failed");
      setOutcome(job);
      for (const s of job.steps) {
        if (s.status === "running" || !s.finishedAt) finishStep(s, "error");
      }
      const pe = primary();
      if (pe) finishStep(pe, "error", `✗ ${result.error}`);
    }

    publish({
      type: "job.finished",
      at: job.finishedAt,
      jobId: job.id,
      action: job.action,
      ok: result.ok,
      result: job.result,
      error: job.error,
      durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
      healed: job.healed,
    });

    await persistRun(job).catch((err) =>
      pushLog(`warn: persist run failed: ${err instanceof Error ? err.message : String(err)}`),
    );
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
      await persistRun(job).catch((persistError) =>
        pushLog(
          `warn: persist cancelled run failed: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
        ),
      );
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
    await persistRun(job).catch(() => undefined);
  } finally {
    await finishEvidence();
    setExecutingJobId(null);
    activeJobId = null;
    clearControl(id);
    if (savedProdMatch === undefined) delete process.env.PROD_ACCOUNT_MATCH;
    else process.env.PROD_ACCOUNT_MATCH = savedProdMatch;
  }
}

/** Attach a live screenshot (base64) to the active or given job + primary step. */
export async function attachJobFrame(opts: {
  jobId?: string;
  base64: string;
  caption: string;
  mime?: string;
}): Promise<TraceFrameRef | null> {
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
  const job = enqueueJob(input);
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
