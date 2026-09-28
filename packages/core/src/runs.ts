/**
 * Persist runs to disk — mirrors qa-viewer runs/<ts>_<flow>_<device>/ layout.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir, stat, rename, unlink, open } from "node:fs/promises";
import { join, basename, isAbsolute, relative, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { TestJob } from "./session.js";
import type { TraceFrameRef, TraceStep } from "./trace.js";
import {
  executionIntentProvenance,
  overlayDestEndIdentityEvidence,
  projectRunTestStepEvidence,
} from "./run-test-step-evidence.js";
import {
  assertExecutionTargetRef,
  parseBrowserCaseProfile,
  parseOptionalRunTestStepEvidence,
  parseOptionalSourceRevision,
  type ActorKind,
  type ArtifactRefProjection,
  type CaptureReferenceComparison,
  type BrowserAuthenticationHealth,
  type BrowserCaseProfile,
  type EvidenceManifest,
  type ExecutionTargetRef,
  type FailureCategory,
  type RunOutcome,
  type RunReview,
  type CaptureReviewDecision,
  type RunTestStepEvidence,
  type SourceRevision,
  type TargetProfile,
} from "@relay/protocol";
import { now } from "./events.js";
import {
  redactResolvedInputs,
  redactText,
  redactValue,
  visualEvidenceAllowed,
} from "./redaction.js";
import {
  catalogRunDirectory,
  catalogRunDirectories,
  catalogSurfaceComparisons,
  catalogSummaries,
  indexRun,
  rebuildRunCatalog,
} from "./run-catalog.js";
import type { RunSummary } from "@relay/protocol";
import {
  listPersistedRunSummariesPageAtRoot,
  listRunSummariesPageAtRoot,
  type RunSummaryPage,
  type RunSummaryPageInput as RunSummaryPageAtRootInput,
  type PersistedRunSummaryPageInput as PersistedRunSummaryPageAtRootInput,
} from "./run-summary-pagination.js";
export { RunListCursorError } from "./run-summary-pagination.js";
export type { RunSummaryPage } from "./run-summary-pagination.js";
export type RunSummaryPageInput = Omit<RunSummaryPageAtRootInput, "rootDirectory">;
export type PersistedRunSummaryPageInput = Omit<
  PersistedRunSummaryPageAtRootInput,
  "rootDirectory" | "loadRuns"
>;
import { findWorkspaceRoot } from "./workspace-root.js";
import { redactPrivateInputs, redactPrivateValue } from "./private-inputs.js";
import {
  artifactMediaKindForMime,
  artifactRefFromBytes,
  missingArtifactRef,
  opaqueArtifactLocation,
  projectArtifactRef,
  redactedArtifactRef,
} from "./artifact-ref.js";
import { readFrameFile, runArtifactFile } from "./run-artifact-files.js";
import { persistedRunIdAt } from "./run-id-probe.js";
import { summarizeRecipeStability } from "./run-stability.js";
export { readFrameFile, runArtifactFile } from "./run-artifact-files.js";
import { formatRunFolder } from "./run-folder.js";
export { formatRunFolder } from "./run-folder.js";
export { findWorkspaceRoot } from "./workspace-root.js";

export type PersistedExecutionProvenance = {
  schemaVersion: 1;
  actorId: string;
  actorKind: ActorKind;
  organizationId: string;
  projectId: string;
  operationId: string;
  requestId: string;
  issuedAt: number;
  causationId?: string;
  correlationId?: string;
  authoringSessionId?: string;
  leaseId?: string;
};

export type PersistedRun = {
  schemaVersion: 2 | 3 | 4 | 5;
  id: string;
  projectId?: string;
  ownerId?: string;
  action: string;
  title?: string;
  serial?: string;
  deviceName?: string;
  platform?: string;
  /** Additive v5 metadata; old reports remain readable without it. */
  executionTarget?: ExecutionTargetRef;
  /** Exact browser environment accepted with the Run. */
  browserCaseProfile?: BrowserCaseProfile;
  targetProfile?: TargetProfile;
  /** Invoked Lane. Additive; older reports omit it. */
  laneId?: string;
  unsignedLaneId?: string;
  authenticationHealth?: BrowserAuthenticationHealth;
  status: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  /** Lineage links are immutable execution provenance, not an instruction to
   * rewrite either run. */
  retryOf?: string;
  retriedBy?: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  result?: unknown;
  error?: string;
  errorCode?: string;
  outcome?: RunOutcome;
  failureCategory?: FailureCategory;
  review?: RunReview;
  /** Saved Plan policy frozen with this Run; legacy absence is human review. */
  referenceReviewMode?: import("@relay/protocol").CaptureReferenceReviewMode;
  /** Human screenshot review. Independent of execution outcome and visual baselines. */
  captureReviews?: CaptureReviewDecision[];
  /** Reference screenshot comparisons keyed by captureId. */
  captureComparisons?: Record<string, CaptureReferenceComparison>;
  /** Durable acknowledgements for capture-review retries. The current decision
   * remains in captureReviews; this bounded history lets a delayed request
   * replay its own acknowledgement without reverting a newer judgement. */
  captureReviewReceipts?: CaptureReviewDecision[];
  appVersion?: string;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  logs: string[];
  steps: TraceStep[];
  /** Additive stable authored-Test-step joins for persisted runtime evidence. */
  testStepEvidence?: RunTestStepEvidence[];
  frames: TraceFrameRef[];
  frameCount?: number;
  dir: string;
  writtenAt: number;
  recipeSnapshot?: TestJob["recipeSnapshot"];
  recipeGraph?: TestJob["recipeGraph"];
  artifacts: TestJob["artifacts"];
  inputDigest: string;
  resolvedInputs: Record<string, string>;
  evidence?: EvidenceManifest;
  /** Bounded, non-secret identity and causality captured when execution was accepted. */
  executionProvenance?: PersistedExecutionProvenance;
  /** Immutable commit/build identity frozen at enqueue time. Fail-closed on
   * parse so a malformed manifest can never pose as audit evidence. */
  sourceRevision?: SourceRevision;
};

export type RunArtifact = TestJob["artifacts"][number];

export type RunReviewAction = "approve" | "reject" | "defer";

export class RunReviewError extends Error {
  readonly code:
    | "RUN_REVIEW_NOT_FOUND"
    | "RUN_REVIEW_UNAVAILABLE"
    | "RUN_REVIEW_CONFLICT"
    | "RUN_REVIEW_ACTOR_REQUIRED";
  readonly recovery: string;

  constructor(code: RunReviewError["code"], message: string, recovery: string) {
    super(message);
    this.name = "RunReviewError";
    this.code = code;
    this.recovery = recovery;
  }
}

const finalizing = new Map<string, Promise<PersistedRun>>();
type RunReviewResult = { run: PersistedRun; review: RunReview };
const runWrites = new Map<string, Promise<unknown>>();
const COMPLETE_MARKER = ".complete";

export function runsRoot(): string {
  const env = process.env.RELAY_RUNS_DIR?.trim();
  if (env) return env;
  const state = process.env.RELAY_STATE_DIR?.trim();
  if (state) return join(state, "runs");
  return join(findWorkspaceRoot(), "runs");
}

function belongsToRunStore(root: string, dir: string): boolean {
  const path = relative(root, dir);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function persistedRunBelongsToStore(root: string, dir: string): boolean {
  return belongsToRunStore(root, dir);
}

export function withRunWriteLock<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const previous = runWrites.get(dir) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  runWrites.set(dir, next);
  const clearLock = () => {
    if (runWrites.get(dir) === next) runWrites.delete(dir);
  };
  void next.then(clearLock, clearLock);
  return next as Promise<T>;
}

export async function readCompletedPersistedRun(dir: string): Promise<PersistedRun | null> {
  return readCompletedRun(dir);
}

export async function persistPersistedRun(
  root: string,
  run: PersistedRun,
  next: PersistedRun,
  purpose = "review",
): Promise<PersistedRun> {
  if (!belongsToRunStore(root, run.dir)) {
    throw new RunReviewError(
      "RUN_REVIEW_UNAVAILABLE",
      "This run is outside the configured Relay run store",
      "Re-open the run from the current project before deciding its review.",
    );
  }
  const json = JSON.stringify(next, null, 2);
  const token = randomUUID();
  const temporary = {
    run: join(run.dir, `.run.json.${purpose}.${token}.tmp`),
    marker: join(run.dir, `.complete.${purpose}.${token}.tmp`),
  };
  const digest = createHash("sha256").update(json).digest("hex");
  try {
    await Promise.all([
      writeFile(temporary.run, json, { encoding: "utf8", flag: "wx" }),
      writeFile(temporary.marker, JSON.stringify({ schemaVersion: 1, id: next.id, digest }), {
        encoding: "utf8",
        flag: "wx",
      }),
    ]);
    await Promise.all(Object.values(temporary).map(syncPath));
    await rename(temporary.run, join(run.dir, "run.json"));
    await rename(temporary.marker, join(run.dir, COMPLETE_MARKER));
    await syncPath(run.dir);
    await indexRun(root, next as unknown as Record<string, unknown>).catch(() => undefined);
  } finally {
    await Promise.all(Object.values(temporary).map((path) => unlink(path).catch(() => undefined)));
  }
  next.dir = run.dir;
  return next;
}

export async function ensureRunDir(job: TestJob): Promise<string> {
  if (job.runDir) {
    await Promise.all([
      mkdir(join(job.runDir, "frames"), { recursive: true }),
      mkdir(join(job.runDir, "video"), { recursive: true }),
    ]);
    return job.runDir;
  }
  const dir = join(runsRoot(), formatRunFolder(job));
  await Promise.all([
    mkdir(join(dir, "frames"), { recursive: true }),
    mkdir(join(dir, "video"), { recursive: true }),
  ]);
  job.runDir = dir;
  return dir;
}

export async function writeFramePng(
  job: TestJob,
  base64: string,
  caption: string,
  options: { stepId?: string; capturedAt?: number } = {},
): Promise<TraceFrameRef> {
  if (!visualEvidenceAllowed()) {
    throw new Error("Visual evidence is disabled while redaction is enabled");
  }
  const dir = await ensureRunDir(job);
  const idx = String(job.frames.length + 1).padStart(3, "0");
  const rel = `frames/${idx}.png`;
  const abs = join(dir, rel);
  const buf = Buffer.from(base64, "base64");
  await writeFile(abs, buf);
  const frame: TraceFrameRef = {
    path: rel,
    caption,
    capturedAt: options.capturedAt ?? now(),
    bytes: buf.byteLength,
    base64,
    mime: "image/png",
    ...(options.stepId ? { stepId: options.stepId } : {}),
  };
  job.frames.push({ ...frame, base64: undefined });
  return frame;
}

function terminalStatus(status: TestJob["status"]): boolean {
  return status === "ok" || status === "error" || status === "healed" || status === "cancelled";
}

function persistedExecutionTarget(job: TestJob): ExecutionTargetRef | undefined {
  if (!job.executionTarget) return undefined;
  // Persisted runs are a replay boundary. Do not let a malformed transport
  // object degrade into an implicitly local serial when the run is reopened.
  assertExecutionTargetRef(job.executionTarget);
  return structuredClone(job.executionTarget);
}

function buildPersistedRun(job: TestJob, dir: string, writtenAt: number): PersistedRun {
  const durationMs =
    job.finishedAt && (job.startedAt ?? job.queuedAt)
      ? job.finishedAt - (job.startedAt ?? job.queuedAt)
      : undefined;

  // strip heavy base64 from disk JSON (files already on disk)
  const frames: TraceFrameRef[] = job.frames.map(({ base64: _b, ...rest }) => rest);
  const steps: TraceStep[] = job.steps.map((s) => ({
    ...s,
    frames: s.frames.map(({ base64: _b, ...rest }) => rest),
  }));
  const testStepEvidence = projectRunTestStepEvidence({
    steps,
    provenance: executionIntentProvenance(job.artifacts),
    events: job.evidence?.events,
    artifacts: job.artifacts,
  });
  const privateSafe = <T>(value: T): T =>
    redactPrivateValue(value, job.resolvedInputs, job.sensitiveInputNames ?? []);
  const executionTarget = persistedExecutionTarget(job);

  const frozenInput = JSON.stringify({
    action: job.action,
    target: {
      kind: job.targetKind ?? "device",
      id: job.browserTargetId ?? job.serial,
      platform: job.targetKind === "browser" ? "browser" : (job.platform ?? "android"),
    },
    executionTarget: executionTarget ?? null,
    browserCaseProfile: job.browserCaseProfile ?? null,
    laneId: job.laneId ?? null,
    unsignedLaneId: job.unsignedLaneId ?? null,
    recipe: job.recipeSnapshot ?? null,
    recipeGraph: job.recipeGraph ?? null,
    variables: job.resolvedInputs,
  });
  return {
    schemaVersion: 5,
    id: job.id,
    projectId: job.projectId,
    ownerId: job.ownerId,
    action: job.action,
    title: job.title,
    serial: job.browserTargetId ?? job.serial,
    deviceName: job.deviceName,
    platform: job.targetKind === "browser" ? "browser" : (job.platform ?? "android"),
    executionTarget,
    browserCaseProfile: job.browserCaseProfile,
    targetProfile: job.targetProfile,
    ...(job.laneId ? { laneId: job.laneId } : {}),
    ...(job.unsignedLaneId ? { unsignedLaneId: job.unsignedLaneId } : {}),
    ...(job.authenticationHealth
      ? { authenticationHealth: structuredClone(job.authenticationHealth) }
      : {}),
    ...(job.sourceRevision ? { sourceRevision: job.sourceRevision } : {}),
    status: job.status,
    healed: job.healed,
    healMessage: job.healMessage,
    attempts: job.attempts,
    retryOf: job.retryOf,
    retriedBy: job.retriedBy,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs,
    result: privateSafe(redactValue(job.result)),
    error: privateSafe(job.error ? redactText(job.error) : job.error),
    errorCode: job.errorCode,
    outcome: job.outcome,
    failureCategory: job.failureCategory,
    review: job.review,
    ...(job.referenceReviewMode ? { referenceReviewMode: job.referenceReviewMode } : {}),
    appVersion: job.appVersion,
    batchId: job.batchId,
    caseIndex: job.caseIndex,
    caseCount: job.caseCount,
    logs: privateSafe(job.logs.map(redactText)),
    steps: privateSafe(steps),
    ...(testStepEvidence.length ? { testStepEvidence: privateSafe(testStepEvidence) } : {}),
    frames: privateSafe(frames),
    frameCount: frames.length,
    dir,
    writtenAt,
    recipeSnapshot: privateSafe(redactValue(job.recipeSnapshot)) as TestJob["recipeSnapshot"],
    recipeGraph: privateSafe(redactValue(job.recipeGraph)) as TestJob["recipeGraph"],
    artifacts: privateSafe(redactValue(job.artifacts)) as TestJob["artifacts"],
    inputDigest: createHash("sha256").update(frozenInput).digest("hex"),
    resolvedInputs: redactPrivateInputs(
      redactResolvedInputs(job.resolvedInputs),
      job.sensitiveInputNames ?? [],
    ),
    evidence: privateSafe(redactValue(job.evidence)) as EvidenceManifest | undefined,
    executionProvenance: persistedExecutionProvenance(job),
  };
}

const MAX_PROVENANCE_IDENTIFIER_LENGTH = 256;

function persistedExecutionProvenance(job: TestJob): PersistedExecutionProvenance | undefined {
  const context = job.operationContext;
  if (!context) return undefined;
  const optional = (value: string | undefined): string | undefined => {
    const bounded = value?.trim().slice(0, MAX_PROVENANCE_IDENTIFIER_LENGTH);
    return bounded || undefined;
  };
  const required = (value: string): string =>
    value.trim().slice(0, MAX_PROVENANCE_IDENTIFIER_LENGTH);
  const causationId = optional(context.causationId);
  const correlationId = optional(context.correlationId);
  const authoringSessionId = optional(context.authoringSessionId);
  const leaseId = optional(context.leaseId);
  return {
    schemaVersion: 1,
    actorId: required(context.actorId),
    actorKind: context.actorKind,
    organizationId: required(context.organizationId),
    projectId: required(context.projectId),
    operationId: required(context.operationId),
    requestId: required(context.requestId),
    issuedAt: context.issuedAt,
    ...(causationId ? { causationId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(authoringSessionId ? { authoringSessionId } : {}),
    ...(leaseId ? { leaseId } : {}),
  };
}

async function readCompletedRun(dir: string): Promise<PersistedRun | null> {
  try {
    const raw = await readFile(join(dir, "run.json"), "utf8");
    const parsed = JSON.parse(raw) as PersistedRun;
    if (parsed.browserCaseProfile !== undefined) {
      parsed.browserCaseProfile = parseBrowserCaseProfile(parsed.browserCaseProfile);
    }
    if (parsed.sourceRevision !== undefined) {
      parsed.sourceRevision = parseOptionalSourceRevision(parsed.sourceRevision);
    }
    if (parsed.testStepEvidence !== undefined) {
      const testStepEvidence = parseOptionalRunTestStepEvidence(parsed.testStepEvidence);
      if (testStepEvidence === undefined) delete parsed.testStepEvidence;
      else {
        parsed.testStepEvidence = overlayDestEndIdentityEvidence({
          items: testStepEvidence,
          steps: parsed.steps ?? [],
          provenance: executionIntentProvenance(parsed.artifacts ?? []),
          artifacts: parsed.artifacts ?? [],
        });
      }
    }
    if (parsed.testStepEvidence === undefined) {
      const projected = projectRunTestStepEvidence({
        steps: parsed.steps ?? [],
        provenance: executionIntentProvenance(parsed.artifacts ?? []),
        artifacts: parsed.artifacts ?? [],
      });
      if (projected.length) parsed.testStepEvidence = projected;
    }
    // Pre-v5 runs did not have an atomic commit marker. They remain readable
    // as historical single-manifest runs, while every current run must pass
    // the marker digest before it is exposed.
    if (parsed.schemaVersion === undefined || parsed.schemaVersion < 5) return parsed;
    if (!existsSync(join(dir, COMPLETE_MARKER))) return null;
    const marker = JSON.parse(await readFile(join(dir, COMPLETE_MARKER), "utf8")) as {
      digest?: string;
    };
    if (marker.digest !== createHash("sha256").update(raw).digest("hex")) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persistRunOnce(job: TestJob): Promise<PersistedRun> {
  if (!terminalStatus(job.status) || !job.finishedAt) {
    throw new Error(`cannot finalize non-terminal run ${job.id} (${job.status})`);
  }
  const dir = await ensureRunDir(job);
  const completed = await readCompletedRun(dir);
  const payload = buildPersistedRun(job, dir, completed?.writtenAt ?? now());
  const json = JSON.stringify(payload, null, 2);

  if (completed) {
    if (JSON.stringify(completed, null, 2) !== json) {
      throw new Error(
        `run integrity conflict: ${job.id} was already finalized with different data`,
      );
    }
    job.persisted = true;
    return completed;
  }

  const token = randomUUID();
  const temporary = {
    run: join(dir, `.run.json.${token}.tmp`),
    log: join(dir, `.log.txt.${token}.tmp`),
    marker: join(dir, `.complete.${token}.tmp`),
  };
  const digest = createHash("sha256").update(json).digest("hex");

  try {
    await Promise.all([
      writeFile(temporary.run, json, { encoding: "utf8", flag: "wx" }),
      writeFile(temporary.log, payload.logs.join("\n"), { encoding: "utf8", flag: "wx" }),
      writeFile(temporary.marker, JSON.stringify({ schemaVersion: 1, id: job.id, digest }), {
        encoding: "utf8",
        flag: "wx",
      }),
    ]);
    await Promise.all(Object.values(temporary).map(syncPath));
    await rename(temporary.run, join(dir, "run.json"));
    await rename(temporary.log, join(dir, "log.txt"));
    await syncPath(dir);
    // The marker is the commit point. Readers ignore schema-v5 manifests until
    // this final rename succeeds, so a crash can leave recoverable files but
    // never a report that looks complete.
    await rename(temporary.marker, join(dir, COMPLETE_MARKER));
    await syncPath(dir);
    // The catalog is a rebuildable accelerator. The immutable manifest remains
    // authoritative if indexing is interrupted.
    const root = runsRoot();
    if (belongsToRunStore(root, dir)) {
      await indexRun(root, payload as unknown as Record<string, unknown>).catch(() => undefined);
    }
  } finally {
    await Promise.all(Object.values(temporary).map((path) => unlink(path).catch(() => undefined)));
  }
  job.persisted = true;
  return payload;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function persistRun(job: TestJob): Promise<PersistedRun> {
  const pending = finalizing.get(job.id);
  if (pending) return pending;
  const next = persistRunOnce(job).finally(() => finalizing.delete(job.id));
  finalizing.set(job.id, next);
  return next;
}

export async function listPersistedRuns(
  limit = 40,
  actionPrefix?: string,
  batchId?: string,
): Promise<PersistedRun[]> {
  const root = runsRoot();
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const runs: PersistedRun[] = [];
  for (const name of entries.sort().reverse()) {
    if (runs.length >= limit) break;
    const dir = join(root, name);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
      const parsed = await readCompletedRun(dir);
      if (!parsed) continue;
      if (actionPrefix && !parsed.action.startsWith(actionPrefix)) continue;
      if (batchId && parsed.batchId !== batchId) continue;
      parsed.dir = dir;
      runs.push(parsed);
    } catch {
      /* skip incomplete */
    }
  }
  return runs;
}

export async function listRunSummaries(limit = 40, appMapId?: string): Promise<RunSummary[]> {
  const root = runsRoot();
  const actionPrefix = appMapId ? `app-map:${appMapId}:` : undefined;
  let summaries = await catalogSummaries(root, limit, actionPrefix);
  if (summaries.length === 0) {
    const catalogIsEmpty = (await catalogSummaries(root, 1)).length === 0;
    if (catalogIsEmpty) {
      await rebuildRunCatalog(root);
      summaries = await catalogSummaries(root, limit, actionPrefix);
    }
  }
  return summaries;
}

export function listRunSummariesPage(input: RunSummaryPageInput): Promise<RunSummaryPage> {
  return listRunSummariesPageAtRoot({ ...input, rootDirectory: runsRoot() });
}

export function listPersistedRunSummariesPage(
  input: PersistedRunSummaryPageInput,
): Promise<RunSummaryPage> {
  return listPersistedRunSummariesPageAtRoot({
    ...input,
    rootDirectory: runsRoot(),
    loadRuns: listPersistedRuns,
  });
}

export async function readPersistedRun(idOrDir: string): Promise<PersistedRun | null> {
  // Match by exact folder name or trailing _<id> segment only — never loose includes().
  const needle = idOrDir.trim();
  if (!needle || needle.includes("/") || needle.includes("\\") || needle.includes("..")) {
    return null;
  }
  const root = runsRoot();
  try {
    const indexed = await catalogRunDirectory(root, needle);
    if (indexed) {
      const parsed = await readCompletedRun(indexed);
      if (!parsed) return null;
      parsed.dir = indexed;
      return parsed;
    }
    const entries = await readdir(root);
    let match =
      entries.find((e) => e === needle || e.endsWith(`_${needle}`) || e.startsWith(`${needle}_`)) ??
      null;
    if (!match) {
      // Unindexed fallback: probe only each manifest's id. A full
      // readCompletedRun per directory re-derives evidence for every run and
      // turned one missing id into seconds of CPU (agent-device-ni65).
      for (const entry of entries) {
        if ((await persistedRunIdAt(join(root, entry))) === needle) {
          match = entry;
          break;
        }
      }
    }
    if (!match) return null;
    const dir = join(root, match);
    const parsed = await readCompletedRun(dir);
    if (!parsed) return null;
    parsed.dir = dir;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve many run ids (keyed by trimmed id) with at most one directory scan.
 * Ids whose run was pruned or never persisted map to null instead of each
 * triggering its own scan.
 */
export async function readPersistedRuns(
  ids: readonly string[],
): Promise<Map<string, PersistedRun | null>> {
  const results = new Map<string, PersistedRun | null>();
  const wanted = [...new Set(ids.map((id) => id.trim()))].filter(
    (id) => id && !id.includes("/") && !id.includes("\\") && !id.includes(".."),
  );
  for (const id of wanted) results.set(id, null);
  if (!wanted.length) return results;
  const root = runsRoot();
  const directories = new Map<string, string>();
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return results;
  }
  const unresolved = new Set<string>();
  const indexedDirectories = await catalogRunDirectories(root, wanted).catch(() => new Map());
  for (const id of wanted) {
    const indexed = indexedDirectories.get(id);
    const named = indexed
      ? null
      : entries.find((e) => e === id || e.endsWith(`_${id}`) || e.startsWith(`${id}_`));
    if (indexed) directories.set(id, indexed);
    else if (named) directories.set(id, join(root, named));
    else unresolved.add(id);
  }
  if (unresolved.size) {
    // Probe the store once in bounded groups. Serial file opens make a
    // preflight quote sensitive to unrelated I/O, while an unbounded scan can
    // overwhelm the same disk under several concurrent Plans.
    const probeConcurrency = 16;
    for (let offset = 0; offset < entries.length && unresolved.size; offset += probeConcurrency) {
      const group = entries.slice(offset, offset + probeConcurrency);
      const ids = await Promise.all(group.map((entry) => persistedRunIdAt(join(root, entry))));
      for (let index = 0; index < group.length; index += 1) {
        const id = ids[index];
        if (!id || !unresolved.has(id)) continue;
        directories.set(id, join(root, group[index]!));
        unresolved.delete(id);
      }
    }
  }
  for (const [id, dir] of directories) {
    const parsed = await readCompletedRun(dir);
    if (!parsed) continue;
    parsed.dir = dir;
    results.set(id, parsed);
  }
  return results;
}

export async function indexedReusableSurfaceComparisons(cacheKey: string) {
  const indexed = await catalogSurfaceComparisons(runsRoot(), cacheKey);
  const candidates = await Promise.all(
    indexed.map(async (candidate) => {
      // The catalog only tells us where to look. Re-read the canonical manifest
      // and verify its commit digest before its evidence is eligible for reuse.
      const run = await readPersistedRun(candidate.runId);
      const artifact = run?.artifacts.find((item) => {
        if (
          item.kind !== "logical-scroll-surface-result" ||
          item.capturedAt !== candidate.artifactCapturedAt
        ) {
          return false;
        }
        const data = item.data as { cache?: { key?: unknown } };
        return data.cache?.key === cacheKey;
      });
      if (!run || !artifact) return null;
      return {
        runId: run.id,
        status: run.status,
        at: run.writtenAt,
        artifactCapturedAt: artifact.capturedAt,
        data: artifact.data,
      };
    }),
  );
  return candidates.filter(
    (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
  );
}

/**
 * Resolve a deferred verification without rewriting the captured evidence.
 * The manifest remains authoritative; only the small review envelope and the
 * derived outcome change. A terminal decision is idempotent so a user can
 * safely recover from a network retry; deferral keeps the review pending and
 * records the latest bounded request context.
 */
async function reviewPersistedRunOnce(
  root: string,
  run: PersistedRun,
  input: {
    action: RunReviewAction;
    actor: { id: string; kind: ActorKind };
    note?: string;
  },
): Promise<RunReviewResult> {
  if (!belongsToRunStore(root, run.dir)) {
    throw new RunReviewError(
      "RUN_REVIEW_UNAVAILABLE",
      "This run is outside the configured Relay run store",
      "Re-open the run from the current project before deciding its review.",
    );
  }
  if (!run.review) {
    throw new RunReviewError(
      "RUN_REVIEW_NOT_FOUND",
      "This run has no deferred check waiting for review",
      "Only runs marked Needs review can be decided here.",
    );
  }
  if (input.actor.kind !== "human") {
    throw new RunReviewError(
      "RUN_REVIEW_ACTOR_REQUIRED",
      "A human must decide this deferred check",
      "Open the run review in Relay and ask a human to mark it correct or unresolved.",
    );
  }
  if (run.review.status !== "pending") {
    const alreadyMatches =
      (run.review.status === "approved" && input.action === "approve") ||
      (run.review.status === "rejected" && input.action === "reject");
    if (alreadyMatches) return { run, review: run.review };
    throw new RunReviewError(
      "RUN_REVIEW_CONFLICT",
      `This run was already ${run.review.status}`,
      "Open the run details to inspect the existing reviewer decision.",
    );
  }

  const decidedAt = now();
  if (input.action === "defer") {
    const review: RunReview = {
      ...run.review,
      requestedAt: decidedAt,
      requestedBy: input.actor,
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 2_000) } : {}),
    };
    const next: PersistedRun = structuredClone(run);
    next.review = review;
    return persistRunReview(root, run, next, review);
  }
  const review: RunReview = {
    ...run.review,
    status: input.action === "approve" ? "approved" : "rejected",
    decidedAt,
    decidedBy: input.actor,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 2_000) } : {}),
  };
  const next: PersistedRun = structuredClone(run);
  next.review = review;
  if (input.action === "approve") {
    next.outcome = "passed";
    next.failureCategory = undefined;
    next.error = undefined;
    next.errorCode = undefined;
  } else {
    next.outcome = "uncertain";
    next.failureCategory = "review-required";
    next.error = review.note ?? "Human review did not approve this check";
    next.errorCode = "REVIEW_REJECTED";
  }

  return persistRunReview(root, run, next, review);
}

async function persistRunReview(
  root: string,
  run: PersistedRun,
  next: PersistedRun,
  review: RunReview,
): Promise<RunReviewResult> {
  const persisted = await persistPersistedRun(root, run, next, "review");
  return { run: persisted, review };
}

/**
 * Serialize decisions for a run within this Relay process and refresh the
 * persisted snapshot before deciding. Review is intentionally a human-only
 * operation, but multiple people can still have the same run open at once.
 */
export function reviewPersistedRun(
  root: string,
  run: PersistedRun,
  input: {
    action: RunReviewAction;
    actor: { id: string; kind: ActorKind };
    note?: string;
  },
): Promise<RunReviewResult> {
  return withRunWriteLock(run.dir, async () => {
    const latest = (await readCompletedRun(run.dir)) ?? run;
    latest.dir = run.dir;
    return reviewPersistedRunOnce(root, latest, input);
  });
}

export async function recipeStability(recipeId: string, limit = 20) {
  const runs = (await listPersistedRuns(200))
    .filter((run) => run.action === recipeId)
    .slice(0, Math.max(1, Math.min(limit, 100)));
  return summarizeRecipeStability(runs);
}

export { projectRunFrameArtifact } from "./run-frame-projection.js";

export {
  RelayRunBundleError,
  exportRelayRunBundle,
  verifyRelayRunBundle,
  type RelayRunBundleEntry,
  type RelayRunBundleErrorCode,
  type RelayRunBundleLimits,
  type RelayRunBundleManifest,
  type RelayRunBundleResult,
  type RelayRunBundleVerification,
} from "./run-bundle.js";
