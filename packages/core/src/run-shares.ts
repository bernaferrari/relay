import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RunShareCreateResult,
  RunShareReport,
  RunShareReportProvenance,
  RunShareReportRun,
  RunShareSummary,
} from "@relay/protocol";
import { destIdentitySourceFrames, failedStepFromTrace } from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import { redactText } from "./redaction.js";

const SHARE_STORE = ".run-shares.json";
const SHARE_SECRET = ".run-share-secret";
const MAX_SHARE_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MIN_SHARE_AGE_MS = 5 * 60 * 1_000;
const MAX_SHARED_RUNS = 500;
const TOKEN_VERSION = 1;

/** Absolute public origin for share links. Loopback development stays
 * path-only; a reverse proxy or desktop host opts in explicitly. Invalid
 * configuration fails loudly instead of minting broken capability links. */
export function publicShareBaseUrl(raw = process.env.RELAY_PUBLIC_BASE_URL): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("RELAY_PUBLIC_BASE_URL must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("RELAY_PUBLIC_BASE_URL must be an absolute http(s) URL");
  }
  return parsed.origin;
}

export type RunShareRecord = {
  schemaVersion: 1;
  id: string;
  runId: string;
  runIds: string[];
  projectId: string;
  ownerId?: string;
  batchId?: string;
  title: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string;
  frameCount: number;
  revokedAt?: number;
  revokedBy?: string;
};

type TokenPayload = { v: 1; id: string; exp: number };
type ShareScope = { projectId: string; ownerId?: string; localTrusted?: boolean };

let writeQueue = Promise.resolve();

function storePath(root: string): string {
  return join(root, SHARE_STORE);
}

function secretPath(root: string): string {
  return join(root, SHARE_SECRET);
}

function statusFor(record: RunShareRecord, at = Date.now()): RunShareSummary["status"] {
  if (record.revokedAt) return "revoked";
  return record.expiresAt <= at ? "expired" : "active";
}

function summaryFor(record: RunShareRecord, at = Date.now()): RunShareSummary {
  return {
    schemaVersion: 1,
    id: record.id,
    runId: record.runId,
    ...(record.batchId ? { batchId: record.batchId } : {}),
    title: record.title,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    createdBy: record.createdBy,
    runCount: record.runIds.length,
    frameCount: record.frameCount,
    status: statusFor(record, at),
    ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
  };
}

function parseRecord(value: unknown): RunShareRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Run share store contains an invalid record");
  }
  const input = value as Partial<RunShareRecord>;
  if (
    input.schemaVersion !== 1 ||
    typeof input.id !== "string" ||
    typeof input.runId !== "string" ||
    !Array.isArray(input.runIds) ||
    !input.runIds.every((id) => typeof id === "string" && id.length > 0) ||
    typeof input.projectId !== "string" ||
    typeof input.title !== "string" ||
    typeof input.createdAt !== "number" ||
    typeof input.expiresAt !== "number" ||
    typeof input.createdBy !== "string" ||
    typeof input.frameCount !== "number"
  ) {
    throw new Error("Run share store contains an invalid record");
  }
  return input as RunShareRecord;
}

async function readStore(root: string): Promise<RunShareRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(storePath(root), "utf8")) as {
      schemaVersion?: unknown;
      shares?: unknown;
    };
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.shares)) {
      throw new Error("Run share store has an unsupported schema");
    }
    return parsed.shares.map(parseRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeStore(root: string, records: RunShareRecord[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const temporary = `${storePath(root)}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ schemaVersion: 1, shares: records }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await rename(temporary, storePath(root));
}

async function mutateStore<T>(
  root: string,
  update: (records: RunShareRecord[]) => { records: RunShareRecord[]; value: T },
): Promise<T> {
  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const current = await readStore(root);
        const next = update(current);
        await writeStore(root, next.records);
        resolveResult(next.value);
      } catch (error) {
        rejectResult(error);
      }
    });
  await writeQueue.catch(() => undefined);
  return result;
}

async function readSecret(root: string): Promise<Buffer> {
  await mkdir(root, { recursive: true });
  try {
    const secret = Buffer.from((await readFile(secretPath(root), "utf8")).trim(), "base64url");
    if (secret.length !== 32) throw new Error("Run share secret is invalid");
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const generated = randomBytes(32);
  try {
    await writeFile(secretPath(root), `${generated.toString("base64url")}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const secret = Buffer.from((await readFile(secretPath(root), "utf8")).trim(), "base64url");
    if (secret.length !== 32) throw new Error("Run share secret is invalid");
    return secret;
  }
}

async function tokenFor(root: string, payload: TokenPayload): Promise<string> {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", await readSecret(root))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function parseToken(
  token: string,
): { body: string; signature: Buffer; payload: TokenPayload } | null {
  const [body, rawSignature, extra] = token.split(".");
  if (!body || !rawSignature || extra || token.length > 1_024) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (
      payload.v !== TOKEN_VERSION ||
      typeof payload.id !== "string" ||
      !payload.id ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp)
    ) {
      return null;
    }
    return { body, signature: Buffer.from(rawSignature, "base64url"), payload };
  } catch {
    return null;
  }
}

function visibleToScope(record: RunShareRecord, scope: ShareScope): boolean {
  return (
    record.projectId === scope.projectId &&
    (scope.localTrusted || !scope.ownerId || record.ownerId === scope.ownerId)
  );
}

function shareableFrames(run: PersistedRun): PersistedRun["frames"] {
  const pngs = run.frames.filter(
    (frame) => frame.mime === "image/png" || frame.path.toLowerCase().endsWith(".png"),
  );
  return destIdentitySourceFrames(pngs, run.artifacts);
}
/** Bounded, redacted reason a run stopped. Share reports expose status plus
 * this one headline — never logs, stack traces, or resolved inputs. */
function errorHeadlineFor(run: PersistedRun): string | undefined {
  const healthy = run.outcome === "passed" || run.status === "ok";
  if (healthy) return undefined;
  const source = [run.error, run.healMessage].find((value) => value?.trim());
  if (!source) return undefined;
  const headline = redactText(source.trim().replace(/\s+/gu, " "));
  return headline.length > 200 ? `${headline.slice(0, 197)}…` : headline;
}

export function failedStepFor(run: Pick<PersistedRun, "steps">) {
  return failedStepFromTrace(run);
}

export async function createRunShare(input: {
  root: string;
  run: PersistedRun;
  relatedRuns: PersistedRun[];
  actorId: string;
  expiresAt: number;
  includeBatch: boolean;
  at?: number;
}): Promise<RunShareCreateResult> {
  const at = input.at ?? Date.now();
  const age = input.expiresAt - at;
  if (!Number.isSafeInteger(input.expiresAt) || age < MIN_SHARE_AGE_MS) {
    throw new Error("Run shares must remain available for at least 5 minutes");
  }
  if (age > MAX_SHARE_AGE_MS) throw new Error("Run shares cannot remain active for over 30 days");
  const projectId = input.run.projectId ?? "local";
  const ownerId = input.run.ownerId;
  const candidates =
    input.includeBatch && input.run.batchId
      ? input.relatedRuns.filter(
          (run) =>
            run.batchId === input.run.batchId &&
            (run.projectId ?? "local") === projectId &&
            run.ownerId === ownerId,
        )
      : [input.run];
  const deduplicated = [...new Map(candidates.map((run) => [run.id, run])).values()];
  if (!deduplicated.some((run) => run.id === input.run.id)) deduplicated.unshift(input.run);
  const runs = deduplicated
    .sort(
      (left, right) =>
        (left.caseIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.caseIndex ?? Number.MAX_SAFE_INTEGER) || left.writtenAt - right.writtenAt,
    )
    .slice(0, MAX_SHARED_RUNS);
  const record: RunShareRecord = {
    schemaVersion: 1,
    id: randomUUID(),
    runId: input.run.id,
    runIds: runs.map((run) => run.id),
    projectId,
    ...(ownerId ? { ownerId } : {}),
    ...(input.includeBatch && input.run.batchId ? { batchId: input.run.batchId } : {}),
    title: redactText(
      input.includeBatch && input.run.batchId
        ? `${input.run.title ?? input.run.action} · matrix results`
        : (input.run.title ?? input.run.action),
    ).slice(0, 160),
    createdAt: at,
    expiresAt: input.expiresAt,
    createdBy: input.actorId,
    frameCount: runs.reduce((total, run) => total + shareableFrames(run).length, 0),
  };
  await mutateStore(input.root, (current) => ({ records: [...current, record], value: undefined }));
  const token = await tokenFor(input.root, { v: 1, id: record.id, exp: record.expiresAt });
  const path = `/shared/runs/${encodeURIComponent(token)}`;
  const baseUrl = publicShareBaseUrl();
  return {
    share: summaryFor(record, at),
    token,
    path,
    ...(baseUrl ? { url: new URL(path, baseUrl).toString() } : {}),
  };
}

export async function listRunShares(
  root: string,
  scope: ShareScope & { runId?: string },
  at = Date.now(),
): Promise<RunShareSummary[]> {
  return (await readStore(root))
    .filter(
      (record) =>
        visibleToScope(record, scope) &&
        (!scope.runId || record.runId === scope.runId || record.runIds.includes(scope.runId)),
    )
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((record) => summaryFor(record, at));
}

export async function revokeRunShare(input: {
  root: string;
  id: string;
  scope: ShareScope;
  actorId: string;
  at?: number;
}): Promise<RunShareSummary | null> {
  const at = input.at ?? Date.now();
  return mutateStore(input.root, (current) => {
    let revoked: RunShareRecord | undefined;
    const records = current.map((record) => {
      if (record.id !== input.id || !visibleToScope(record, input.scope)) return record;
      revoked = record.revokedAt ? record : { ...record, revokedAt: at, revokedBy: input.actorId };
      return revoked;
    });
    return { records, value: revoked ? summaryFor(revoked, at) : null };
  });
}

/** Retention sweep for share records. Deletes every record whose expiry has
 * passed — including revoked ones, whose audit summary is the only thing this
 * store keeps. Returns how many records were pruned so startup wiring can log
 * a bounded line. Run-directory garbage collection is a separate concern and
 * intentionally out of scope here: it will key off runs retention metadata
 * (see run-catalog retention planning) rather than share expiries.
 */
export async function pruneExpiredShares(root: string, at = Date.now()): Promise<number> {
  return mutateStore(root, (current) => {
    const kept = current.filter((record) => record.expiresAt > at);
    return { records: kept, value: current.length - kept.length };
  });
}

/** Real public path for an existing active share covering a run, so callers
 * never fabricate links. Shares resolve by HMAC token — never by run id — and
 * the token is recomputable because exp equals the record's expiresAt. When
 * several active shares cover the run, the newest wins. Returns undefined
 * when no non-revoked, unexpired share exists. */
export async function findActiveRunSharePath(
  root: string,
  runId: string,
  at = Date.now(),
): Promise<string | undefined> {
  const candidates = (await readStore(root))
    .filter(
      (record) =>
        !record.revokedAt &&
        record.expiresAt > at &&
        (record.runId === runId || record.runIds.includes(runId)),
    )
    .sort((left, right) => right.createdAt - left.createdAt);
  const record = candidates[0];
  if (!record) return undefined;
  const token = await tokenFor(root, { v: 1, id: record.id, exp: record.expiresAt });
  return `/shared/runs/${token}`;
}

export type RunShareTokenResolution =
  | { state: "active"; record: RunShareRecord }
  | { state: "expired" }
  | { state: "invalid" };

/** Authenticate a bearer capability and say how it failed. Only genuinely
 * aged-out tokens stay distinguishable, so public pages can render an honest
 * tombstone; every other failure collapses to "invalid" without revealing
 * whether an id, signature, or record mismatched. */
export async function resolveRunShareTokenState(
  root: string,
  token: string,
  at = Date.now(),
): Promise<RunShareTokenResolution> {
  const parsed = parseToken(token);
  if (!parsed) return { state: "invalid" };
  const expected = createHmac("sha256", await readSecret(root))
    .update(parsed.body)
    .digest();
  if (expected.length !== parsed.signature.length || !timingSafeEqual(expected, parsed.signature)) {
    return { state: "invalid" };
  }
  if (parsed.payload.exp <= at) return { state: "expired" };
  const record = (await readStore(root)).find((candidate) => candidate.id === parsed.payload.id);
  if (!record || record.revokedAt || record.expiresAt !== parsed.payload.exp) {
    return { state: "invalid" };
  }
  return { state: "active", record };
}

export async function resolveRunShareToken(
  root: string,
  token: string,
  at = Date.now(),
): Promise<RunShareRecord | null> {
  const resolution = await resolveRunShareTokenState(root, token, at);
  return resolution.state === "active" ? resolution.record : null;
}

export function buildRunShareReport(record: RunShareRecord, runs: PersistedRun[]): RunShareReport {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const projected: Array<{ run: PersistedRun; report: RunShareReportRun }> = record.runIds.flatMap(
    (id) => {
      const run = byId.get(id);
      if (!run) return [];
      const failedStep = failedStepFor(run);
      return [
        {
          run,
          report: {
            id: run.id,
            title: run.title ?? run.action,
            status: run.status,
            ...(run.outcome ? { outcome: run.outcome } : {}),
            ...(run.platform ? { platform: run.platform } : {}),
            ...(run.startedAt ? { startedAt: run.startedAt } : {}),
            ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
            ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
            ...(run.caseIndex !== undefined ? { caseIndex: run.caseIndex } : {}),
            ...(run.caseCount !== undefined ? { caseCount: run.caseCount } : {}),
            ...(errorHeadlineFor(run) ? { errorHeadline: errorHeadlineFor(run) } : {}),
            ...(failedStep ? { failedStep } : {}),
            ...(run.failureCategory && !isHealthy(run)
              ? { failureCategory: run.failureCategory }
              : {}),
            frames: shareableFrames(run).map((frame, index) => ({
              index,
              caption: frame.caption || `Screen ${index + 1}`,
              capturedAt: frame.capturedAt,
              ...(frame.width ? { width: frame.width } : {}),
              ...(frame.height ? { height: frame.height } : {}),
            })),
          },
        },
      ];
    },
  );
  const reportRuns = projected.map(({ report }) => report);
  const passed = projected.filter(({ run }) => isHealthy(run)).length;
  const inProgress = projected.filter(({ run }) =>
    ["queued", "running", "paused"].includes(run.status),
  ).length;
  return {
    schemaVersion: 1,
    share: {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    },
    provenance: shareProvenance(projected.map(({ run }) => run)),
    totals: {
      runs: reportRuns.length,
      passed,
      // Non-terminal runs are not verdicts; they surface as a neutral
      // "In progress" bucket instead of inflating the problem count.
      problems: reportRuns.length - passed - inProgress,
      screenshots: reportRuns.reduce((total, run) => total + run.frames.length, 0),
      inProgress,
    },
    runs: reportRuns,
  };
}

function isHealthy(run: PersistedRun): boolean {
  return run.outcome === "passed" || run.status === "ok";
}

/** One identity block for the whole share. Values come from the primary run
 * first; matrix cells may only widen what the primary does not record.
 * Nothing here exposes device identifiers or resolved inputs. */
function shareProvenance(runs: PersistedRun[]): RunShareReportProvenance | undefined {
  if (runs.length === 0) return undefined;
  const primary = runs[0]!;
  const startedCandidates = runs
    .map((run) => run.startedAt)
    .filter((value): value is number => value !== undefined);
  const completedCandidates = runs
    .map((run) => run.finishedAt)
    .filter((value): value is number => value !== undefined);
  return {
    ...(primary.appVersion ? { appVersion: primary.appVersion } : {}),
    ...(primary.platform ? { platform: primary.platform } : {}),
    ...(primary.targetProfile?.id ? { profileId: primary.targetProfile.id } : {}),
    ...((primary.deviceName ?? primary.targetProfile?.name)
      ? { deviceName: primary.deviceName ?? primary.targetProfile?.name }
      : {}),
    ...shareAppMapRevision(primary),
    ...shareSourceRevision(primary),
    ...(startedCandidates.length > 0 ? { startedAt: Math.min(...startedCandidates) } : {}),
    ...(completedCandidates.length > 0 ? { completedAt: Math.max(...completedCandidates) } : {}),
  };
}

/** The App Map revision a Test run was compiled from, projected from its
 * frozen execution-intent artifact without trusting an unchecked shape. */
function shareAppMapRevision(run: PersistedRun): RunShareReportProvenance | undefined {
  for (const artifact of run.artifacts) {
    if (artifact.kind !== "app-map-test-execution-intent") continue;
    const data = artifact.data;
    if (!data || typeof data !== "object") continue;
    const sourcePlan = "sourcePlan" in data ? data.sourcePlan : undefined;
    if (!sourcePlan || typeof sourcePlan !== "object") continue;
    const revision = "appMapRevision" in sourcePlan ? sourcePlan.appMapRevision : undefined;
    if (typeof revision === "number") return { appMapRevision: revision };
  }
  return undefined;
}

/** The PR-proof identity of the code under test. Relay records it as plain
 * frozen input names so any CI bridge can attach it without a protocol bump. */
function shareSourceRevision(run: PersistedRun): RunShareReportProvenance | undefined {
  const sha = run.resolvedInputs.commit_sha?.trim() || run.resolvedInputs.git_sha?.trim();
  if (!sha) return undefined;
  const prNumber = Number.parseInt(run.resolvedInputs.pr_number ?? "", 10);
  return {
    sourceRevision: { sha, ...(Number.isSafeInteger(prNumber) ? { prNumber } : {}) },
  };
}
