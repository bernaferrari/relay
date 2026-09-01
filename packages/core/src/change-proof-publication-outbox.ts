import { randomUUID } from "node:crypto";
import {
  changeProofPublicationIntentSchema,
  changeProofPublicationOutboxRecordSchema,
  changeProofPublicationReceiptSchema,
  type ChangeProofPublicationIntent,
  type ChangeProofPublicationOutboxFailureKind,
  type ChangeProofPublicationOutboxRecord,
  type ChangeProofPublicationReceipt,
} from "@relay/protocol";
import { readControlStore, withControlStore, type ControlStore } from "./collaboration-store.js";
import { readChangeProofPublications } from "./change-proof-publication.js";
import { canonicalSha256 } from "./canonical-json.js";
/* Keep the import above separate from the store import: the publication
 * receipt reader is the existing provider-reconciliation seam. */

export const CHANGE_PROOF_PUBLICATION_OUTBOX_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CHANGE_PROOF_PUBLICATION_MAX_ATTEMPTS = 5;
export const DEFAULT_CHANGE_PROOF_PUBLICATION_LEASE_MS = 60_000;
export const DEFAULT_CHANGE_PROOF_PUBLICATION_BACKOFF_MS = 1_000;
export const MAX_CHANGE_PROOF_PUBLICATION_BACKOFF_MS = 15 * 60_000;

export type ChangeProofPublicationScope = {
  organizationId: string;
  projectId: string;
};

export type EnqueueChangeProofPublicationInput = ChangeProofPublicationScope & {
  /** Optional caller id. When omitted, the id is derived from the immutable
   * publication identity and is therefore safe to retry. */
  id?: string;
  proofId: string;
  proofVersion: number;
  provider: "github";
  repository: string;
  headSha: string;
  externalId: string;
  check: unknown;
  maxAttempts?: number;
  createdAt?: number;
};

export type ClaimChangeProofPublicationInput = ChangeProofPublicationScope & {
  id?: string;
  workerId: string;
  now?: number;
  leaseMs?: number;
};

export type ChangeProofPublicationOutboxFailureInput = ChangeProofPublicationScope & {
  id: string;
  workerId: string;
  leaseToken: string;
  kind?: ChangeProofPublicationOutboxFailureKind;
  at?: number;
  backoffMs?: number;
};

export type MarkChangeProofPublicationPublishedInput = ChangeProofPublicationScope & {
  id: string;
  receipt: ChangeProofPublicationReceipt;
  workerId?: string;
  leaseToken?: string;
  at?: number;
};

export type RequestChangeProofPublicationRecoveryInput = ChangeProofPublicationScope & {
  id: string;
  proofId: string;
  proofVersion: number;
  actorId: string;
  requestId: string;
  requestDigest: `sha256:${string}`;
  at?: number;
};

export type ChangeProofPublicationRecoveryResult = {
  record: ChangeProofPublicationOutboxRecord;
  disposition: "retry-scheduled" | "already-published" | "existing";
};

export type ChangeProofPublicationOutboxWorkerResult =
  | { status: "idle"; record?: undefined }
  | { status: "published"; record: ChangeProofPublicationOutboxRecord }
  | { status: "retry"; record: ChangeProofPublicationOutboxRecord };

export type ChangeProofPublicationExecutor = (
  intent: ChangeProofPublicationIntent,
) => Promise<ChangeProofPublicationReceipt>;

export class ChangeProofPublicationOutboxError extends Error {
  readonly code:
    | "OUTBOX_INTENT_CONFLICT"
    | "OUTBOX_NOT_FOUND"
    | "OUTBOX_INVALID_TRANSITION"
    | "OUTBOX_LEASE_LOST"
    | "OUTBOX_ATTEMPTS_EXHAUSTED"
    | "OUTBOX_RECEIPT_MISMATCH";

  constructor(code: ChangeProofPublicationOutboxError["code"], message: string) {
    super(message);
    this.name = "ChangeProofPublicationOutboxError";
    this.code = code;
  }
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative timestamp`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${field} must be an integer between 1 and ${max}`);
  }
  return value;
}

function maxAttempts(value: number | undefined): number {
  return positiveInteger(value ?? DEFAULT_CHANGE_PROOF_PUBLICATION_MAX_ATTEMPTS, "maxAttempts", 32);
}

function clone<T>(value: T): T {
  // Documents cross the SQLite JSON seam. Mirroring JSON serialization here
  // keeps optional fields absent in memory exactly as they are after restart.
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Project the immutable provider request out of a durable outbox row. The
 * worker must not pass mutable lifecycle fields (lease, retry counters, or a
 * receipt) through the provider boundary. */
export function changeProofPublicationIntentFromOutboxRecord(
  record: ChangeProofPublicationOutboxRecord,
): ChangeProofPublicationIntent {
  const parsed = changeProofPublicationOutboxRecordSchema.parse(record);
  return changeProofPublicationIntentSchema.parse({
    schemaVersion: parsed.schemaVersion,
    id: parsed.id,
    organizationId: parsed.organizationId,
    projectId: parsed.projectId,
    proofId: parsed.proofId,
    proofVersion: parsed.proofVersion,
    provider: parsed.provider,
    repository: parsed.repository,
    headSha: parsed.headSha,
    externalId: parsed.externalId,
    check: parsed.check,
    createdAt: parsed.createdAt,
  });
}

function scopeOf(value: ChangeProofPublicationScope): ChangeProofPublicationScope {
  return {
    organizationId: nonEmpty(value.organizationId, "organizationId"),
    projectId: nonEmpty(value.projectId, "projectId"),
  };
}

function publicationIdentity(
  value: Pick<
    EnqueueChangeProofPublicationInput,
    | "organizationId"
    | "projectId"
    | "proofId"
    | "provider"
    | "repository"
    | "headSha"
    | "externalId"
    | "check"
    | "proofVersion"
  >,
): string {
  return canonicalSha256({
    organizationId: value.organizationId,
    projectId: value.projectId,
    proofId: value.proofId,
    proofVersion: value.proofVersion,
    provider: value.provider,
    repository: value.repository,
    headSha: value.headSha,
    externalId: value.externalId,
    check: value.check,
  });
}

function generatedIntentId(input: EnqueueChangeProofPublicationInput): string {
  return `change-proof-publication:${publicationIdentity(input).slice("sha256:".length)}`;
}

function intentFromInput(input: EnqueueChangeProofPublicationInput): ChangeProofPublicationIntent {
  const scope = scopeOf(input);
  const proofId = nonEmpty(input.proofId, "proofId");
  const provider = input.provider;
  if (provider !== "github") throw new Error("Only GitHub Proof publication is supported");
  return changeProofPublicationIntentSchema.parse({
    schemaVersion: CHANGE_PROOF_PUBLICATION_OUTBOX_SCHEMA_VERSION,
    id: input.id === undefined ? generatedIntentId(input) : nonEmpty(input.id, "id"),
    ...scope,
    proofId,
    proofVersion: positiveInteger(input.proofVersion, "proofVersion", Number.MAX_SAFE_INTEGER),
    provider,
    repository: nonEmpty(input.repository, "repository"),
    headSha: nonEmpty(input.headSha, "headSha"),
    externalId: nonEmpty(input.externalId, "externalId"),
    check: input.check,
    createdAt: timestamp(input.createdAt ?? Date.now(), "createdAt"),
  });
}

function sameIntent(
  record: ChangeProofPublicationOutboxRecord,
  intent: ChangeProofPublicationIntent,
): boolean {
  return publicationIdentity(record) === publicationIdentity(intent);
}

function requiredInScope(
  store: ControlStore,
  scope: ChangeProofPublicationScope,
  id: string,
): ChangeProofPublicationOutboxRecord {
  const record = store.changeProofPublicationOutbox(scope.organizationId, scope.projectId, id);
  if (!record) {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_NOT_FOUND",
      "Change Proof publication intent was not found in this project",
    );
  }
  return changeProofPublicationOutboxRecordSchema.parse(record);
}

function assertLease(
  record: ChangeProofPublicationOutboxRecord,
  workerId: string,
  leaseToken: string,
): void {
  if (
    record.status !== "claimed" ||
    record.lease?.workerId !== workerId ||
    record.lease.token !== leaseToken
  ) {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_LEASE_LOST",
      "Change Proof publication worker lease is no longer active",
    );
  }
}

function write(
  store: ControlStore,
  next: ChangeProofPublicationOutboxRecord,
): ChangeProofPublicationOutboxRecord {
  const normalized = changeProofPublicationOutboxRecordSchema.parse(next);
  if (!store.updateChangeProofPublicationOutbox(normalized)) {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_NOT_FOUND",
      "Change Proof publication intent disappeared during update",
    );
  }
  return clone(normalized);
}

function recoverExpiredInStore(
  store: ControlStore,
  scope: ChangeProofPublicationScope | undefined,
  at: number,
): ChangeProofPublicationOutboxRecord[] {
  const recovered: ChangeProofPublicationOutboxRecord[] = [];
  for (const current of store.changeProofPublicationOutboxes(
    scope?.organizationId,
    scope?.projectId,
  )) {
    const record = changeProofPublicationOutboxRecordSchema.parse(current);
    if (record.status !== "claimed" || !record.lease || record.lease.expiresAt > at) continue;
    recovered.push(
      write(store, {
        ...record,
        status: "retry",
        lease: undefined,
        ...(record.attempts < record.maxAttempts
          ? { nextAttemptAt: at }
          : { nextAttemptAt: undefined }),
        updatedAt: at,
      }),
    );
  }
  return recovered;
}

/** Synchronous seam used by terminal Proof writers. Calling this from an
 * existing `withControlStore` callback makes enqueue and the terminal Proof
 * append part of one SQLite transaction. */
export function enqueueChangeProofPublicationOutboxInStore(
  store: ControlStore,
  input: EnqueueChangeProofPublicationInput,
): ChangeProofPublicationOutboxRecord {
  const intent = intentFromInput(input);
  const scope = scopeOf(input);
  const existing = store.changeProofPublicationOutboxByLogicalKey(
    scope.organizationId,
    scope.projectId,
    intent.proofId,
    intent.proofVersion,
    intent.provider,
  );
  if (existing) {
    const parsed = changeProofPublicationOutboxRecordSchema.parse(existing);
    if (sameIntent(parsed, intent)) return clone(parsed);
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_INTENT_CONFLICT",
      "A different terminal publication intent already exists for this Proof",
    );
  }
  const byId = store.changeProofPublicationOutbox(scope.organizationId, scope.projectId, intent.id);
  if (byId) {
    const parsed = changeProofPublicationOutboxRecordSchema.parse(byId);
    if (sameIntent(parsed, intent)) return clone(parsed);
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_INTENT_CONFLICT",
      "A different terminal publication intent already uses this id",
    );
  }
  const record = changeProofPublicationOutboxRecordSchema.parse({
    ...intent,
    status: "pending",
    attempts: 0,
    maxAttempts: maxAttempts(input.maxAttempts),
    updatedAt: intent.createdAt,
  });
  if (!store.insertChangeProofPublicationOutbox(record)) {
    const concurrent = store.changeProofPublicationOutboxByLogicalKey(
      scope.organizationId,
      scope.projectId,
      intent.proofId,
      intent.proofVersion,
      intent.provider,
    );
    if (
      concurrent &&
      sameIntent(changeProofPublicationOutboxRecordSchema.parse(concurrent), intent)
    ) {
      return clone(changeProofPublicationOutboxRecordSchema.parse(concurrent));
    }
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_INTENT_CONFLICT",
      "Change Proof publication intent could not be inserted consistently",
    );
  }
  return clone(record);
}

export async function enqueueChangeProofPublicationOutbox(
  input: EnqueueChangeProofPublicationInput,
): Promise<ChangeProofPublicationOutboxRecord> {
  return withControlStore((store) => enqueueChangeProofPublicationOutboxInStore(store, input));
}

export function readChangeProofPublicationOutboxInStore(
  store: ControlStore,
  scope: ChangeProofPublicationScope,
  id: string,
): ChangeProofPublicationOutboxRecord | undefined {
  const normalized = scopeOf(scope);
  const normalizedId = nonEmpty(id, "id");
  const record = store.changeProofPublicationOutbox(
    normalized.organizationId,
    normalized.projectId,
    normalizedId,
  );
  return record ? clone(changeProofPublicationOutboxRecordSchema.parse(record)) : undefined;
}

export async function readChangeProofPublicationOutbox(
  scope: ChangeProofPublicationScope,
  id: string,
): Promise<ChangeProofPublicationOutboxRecord | undefined> {
  return readControlStore((store) => readChangeProofPublicationOutboxInStore(store, scope, id));
}

export function listChangeProofPublicationOutboxInStore(
  store: ControlStore,
  scope: ChangeProofPublicationScope,
): ChangeProofPublicationOutboxRecord[] {
  const normalized = scopeOf(scope);
  return store
    .changeProofPublicationOutboxes(normalized.organizationId, normalized.projectId)
    .map((record) => clone(changeProofPublicationOutboxRecordSchema.parse(record)));
}

export async function listChangeProofPublicationOutbox(
  scope: ChangeProofPublicationScope,
): Promise<ChangeProofPublicationOutboxRecord[]> {
  return readControlStore((store) => listChangeProofPublicationOutboxInStore(store, scope));
}

/** Internal worker inventory across all scopes. Callers must not expose this
 * projection through a project-scoped API. */
export async function listAllChangeProofPublicationOutbox(): Promise<
  ChangeProofPublicationOutboxRecord[]
> {
  return readControlStore((store) =>
    store
      .changeProofPublicationOutboxes()
      .map((record) => clone(changeProofPublicationOutboxRecordSchema.parse(record))),
  );
}

function claimInStore(
  store: ControlStore,
  input: ClaimChangeProofPublicationInput,
): ChangeProofPublicationOutboxRecord | undefined {
  const now = timestamp(input.now ?? Date.now(), "now");
  const workerId = nonEmpty(input.workerId, "workerId");
  const leaseMs = positiveInteger(
    input.leaseMs ?? DEFAULT_CHANGE_PROOF_PUBLICATION_LEASE_MS,
    "leaseMs",
    24 * 60 * 60_000,
  );
  const scope = scopeOf(input);
  recoverExpiredInStore(store, scope, now);
  const parsedRecords = store
    .changeProofPublicationOutboxes(scope.organizationId, scope.projectId)
    .map((value) => changeProofPublicationOutboxRecordSchema.parse(value));
  const requestedId = input.id ? nonEmpty(input.id, "id") : undefined;
  const current = parsedRecords.find((record) => {
    if (requestedId && record.id !== requestedId) return false;
    if (!record || record.status === "published" || record.attempts >= record.maxAttempts)
      return false;
    const earlierUnresolvedVersion = parsedRecords.some(
      (candidate) =>
        candidate.proofId === record.proofId &&
        candidate.provider === record.provider &&
        candidate.repository === record.repository &&
        candidate.headSha === record.headSha &&
        candidate.externalId === record.externalId &&
        candidate.proofVersion < record.proofVersion &&
        candidate.status !== "published" &&
        candidate.attempts < candidate.maxAttempts,
    );
    if (earlierUnresolvedVersion) return false;
    if (record.status === "pending") return true;
    return (
      record.status === "retry" && record.nextAttemptAt !== undefined && record.nextAttemptAt <= now
    );
  });
  if (!current) return undefined;
  const next = changeProofPublicationOutboxRecordSchema.parse({
    ...current,
    status: "claimed",
    attempts: current.attempts + 1,
    nextAttemptAt: undefined,
    lease: {
      workerId,
      token: randomUUID(),
      claimedAt: now,
      expiresAt: now + leaseMs,
    },
    updatedAt: now,
  });
  return write(store, next);
}

export function claimChangeProofPublicationOutboxInStore(
  store: ControlStore,
  input: ClaimChangeProofPublicationInput,
): ChangeProofPublicationOutboxRecord | undefined {
  return claimInStore(store, input);
}

export async function claimChangeProofPublicationOutbox(
  input: ClaimChangeProofPublicationInput,
): Promise<ChangeProofPublicationOutboxRecord | undefined> {
  return withControlStore((store) => claimInStore(store, input));
}

export function heartbeatChangeProofPublicationOutboxInStore(
  store: ControlStore,
  input: ChangeProofPublicationScope & {
    id: string;
    workerId: string;
    leaseToken: string;
    at?: number;
    leaseMs?: number;
  },
): ChangeProofPublicationOutboxRecord {
  const scope = scopeOf(input);
  const at = timestamp(input.at ?? Date.now(), "at");
  const leaseMs = positiveInteger(
    input.leaseMs ?? DEFAULT_CHANGE_PROOF_PUBLICATION_LEASE_MS,
    "leaseMs",
    24 * 60 * 60_000,
  );
  const record = requiredInScope(store, scope, nonEmpty(input.id, "id"));
  assertLease(
    record,
    nonEmpty(input.workerId, "workerId"),
    nonEmpty(input.leaseToken, "leaseToken"),
  );
  return write(store, {
    ...record,
    lease: { ...record.lease!, expiresAt: at + leaseMs },
    updatedAt: at,
  });
}

export async function heartbeatChangeProofPublicationOutbox(
  input: ChangeProofPublicationScope & {
    id: string;
    workerId: string;
    leaseToken: string;
    at?: number;
    leaseMs?: number;
  },
): Promise<ChangeProofPublicationOutboxRecord> {
  return withControlStore((store) => heartbeatChangeProofPublicationOutboxInStore(store, input));
}

/** Keep one exact claimed publication alive while its provider call is in
 * flight. Heartbeats are serialized so a late tick cannot race the terminal
 * receipt/retry transition, and a lost lease fails the provider operation
 * closed instead of allowing a stale worker to publish. */
export async function withChangeProofPublicationLeaseHeartbeat<T>(
  input: ChangeProofPublicationScope & {
    id: string;
    workerId: string;
    leaseToken: string;
    leaseMs?: number;
    heartbeatMs?: number;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const leaseMs = positiveInteger(
    input.leaseMs ?? DEFAULT_CHANGE_PROOF_PUBLICATION_LEASE_MS,
    "leaseMs",
    24 * 60 * 60_000,
  );
  const heartbeatMs = positiveInteger(
    input.heartbeatMs ?? Math.max(1, Math.floor(leaseMs / 2)),
    "heartbeatMs",
    24 * 60 * 60_000,
  );
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const heartbeat = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat.then(async () => {
      if (heartbeatFailure !== undefined) return;
      try {
        await heartbeatChangeProofPublicationOutbox({
          organizationId: input.organizationId,
          projectId: input.projectId,
          id: input.id,
          workerId: input.workerId,
          leaseToken: input.leaseToken,
          leaseMs,
        });
      } catch (error) {
        heartbeatFailure = error;
      }
    });
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    const result = await operation();
    await pendingHeartbeat;
    if (heartbeatFailure !== undefined) throw heartbeatFailure;
    return result;
  } finally {
    clearInterval(heartbeat);
    await pendingHeartbeat;
  }
}

export function markChangeProofPublicationRetryInStore(
  store: ControlStore,
  input: ChangeProofPublicationOutboxFailureInput,
): ChangeProofPublicationOutboxRecord {
  const scope = scopeOf(input);
  const at = timestamp(input.at ?? Date.now(), "at");
  const record = requiredInScope(store, scope, nonEmpty(input.id, "id"));
  assertLease(
    record,
    nonEmpty(input.workerId, "workerId"),
    nonEmpty(input.leaseToken, "leaseToken"),
  );
  const backoff = Math.min(
    MAX_CHANGE_PROOF_PUBLICATION_BACKOFF_MS,
    Math.max(0, input.backoffMs ?? DEFAULT_CHANGE_PROOF_PUBLICATION_BACKOFF_MS) *
      2 ** Math.max(0, record.attempts - 1),
  );
  const retryAt = record.attempts < record.maxAttempts ? at + backoff : undefined;
  return write(store, {
    ...record,
    status: "retry",
    lease: undefined,
    ...(retryAt === undefined ? { nextAttemptAt: undefined } : { nextAttemptAt: retryAt }),
    lastFailure: { kind: input.kind ?? "provider-error", at },
    updatedAt: at,
  });
}

export async function markChangeProofPublicationRetry(
  input: ChangeProofPublicationOutboxFailureInput,
): Promise<ChangeProofPublicationOutboxRecord> {
  return withControlStore((store) => markChangeProofPublicationRetryInStore(store, input));
}

/** Grant one explicitly confirmed retry without changing the immutable
 * provider/check identity or discarding prior attempt history. The request
 * receipt makes network retries idempotent and rejects request-id reuse with
 * a different operator intent. */
export function requestChangeProofPublicationRecoveryInStore(
  store: ControlStore,
  input: RequestChangeProofPublicationRecoveryInput,
): ChangeProofPublicationRecoveryResult {
  const scope = scopeOf(input);
  const at = timestamp(input.at ?? Date.now(), "at");
  const record = requiredInScope(store, scope, nonEmpty(input.id, "id"));
  const proofId = nonEmpty(input.proofId, "proofId");
  const proofVersion = positiveInteger(input.proofVersion, "proofVersion", Number.MAX_SAFE_INTEGER);
  const actorId = nonEmpty(input.actorId, "actorId");
  const requestId = nonEmpty(input.requestId, "requestId");
  const requestDigest = input.requestDigest;
  if (!/^sha256:[a-f0-9]{64}$/u.test(requestDigest)) {
    throw new Error("requestDigest must be a canonical sha256 digest");
  }
  if (record.proofId !== proofId || record.proofVersion !== proofVersion) {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_INTENT_CONFLICT",
      "Proof publication recovery does not identify this exact Proof revision",
    );
  }
  if (record.recovery?.requestId === requestId) {
    if (record.recovery.requestDigest !== requestDigest) {
      throw new ChangeProofPublicationOutboxError(
        "OUTBOX_INTENT_CONFLICT",
        "Proof publication recovery request id is already bound to another intent",
      );
    }
    return {
      record: clone(record),
      disposition: record.status === "published" ? "already-published" : "existing",
    };
  }
  if (record.status === "published") {
    return { record: clone(record), disposition: "already-published" };
  }
  if (record.status === "claimed") {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_INVALID_TRANSITION",
      "Proof publication is currently being delivered",
    );
  }
  if (record.status !== "retry" || record.attempts < record.maxAttempts) {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_INVALID_TRANSITION",
      "Proof publication retries are not exhausted",
    );
  }
  if (record.maxAttempts >= 32) {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_ATTEMPTS_EXHAUSTED",
      "Proof publication reached the maximum recoverable attempt count",
    );
  }
  const next = write(store, {
    ...record,
    maxAttempts: record.maxAttempts + 1,
    nextAttemptAt: at,
    recovery: { requestId, requestDigest, requestedBy: actorId, requestedAt: at },
    updatedAt: at,
  });
  return { record: next, disposition: "retry-scheduled" };
}

export async function requestChangeProofPublicationRecovery(
  input: RequestChangeProofPublicationRecoveryInput,
): Promise<ChangeProofPublicationRecoveryResult> {
  return withControlStore((store) => requestChangeProofPublicationRecoveryInStore(store, input));
}

function receiptMatchesIntent(
  record: ChangeProofPublicationOutboxRecord,
  receipt: ChangeProofPublicationReceipt,
): boolean {
  return (
    receipt.organizationId === record.organizationId &&
    receipt.projectId === record.projectId &&
    receipt.proofId === record.proofId &&
    receipt.proofVersion === record.proofVersion &&
    receipt.provider === record.provider &&
    receipt.repository === record.repository &&
    receipt.headSha === record.headSha &&
    receipt.externalId === record.externalId &&
    receipt.checkDigest === canonicalSha256(record.check) &&
    (receipt.status ?? "completed") === record.check.status &&
    receipt.conclusion === record.check.conclusion
  );
}

export function markChangeProofPublicationPublishedInStore(
  store: ControlStore,
  input: MarkChangeProofPublicationPublishedInput,
): ChangeProofPublicationOutboxRecord {
  const scope = scopeOf(input);
  const at = timestamp(input.at ?? Date.now(), "at");
  const record = requiredInScope(store, scope, nonEmpty(input.id, "id"));
  const receipt = changeProofPublicationReceiptSchema.parse(input.receipt);
  if (!receiptMatchesIntent(record, receipt)) {
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_RECEIPT_MISMATCH",
      "Provider receipt does not identify this exact Proof publication intent",
    );
  }
  if (record.status === "published") {
    if (JSON.stringify(record.receipt) === JSON.stringify(receipt)) return clone(record);
    throw new ChangeProofPublicationOutboxError(
      "OUTBOX_RECEIPT_MISMATCH",
      "A different provider receipt is already recorded for this publication",
    );
  }
  if (record.status === "claimed") {
    if (!input.workerId || !input.leaseToken) {
      throw new ChangeProofPublicationOutboxError(
        "OUTBOX_LEASE_LOST",
        "Publishing a claimed intent requires its worker lease",
      );
    }
    assertLease(
      record,
      nonEmpty(input.workerId, "workerId"),
      nonEmpty(input.leaseToken, "leaseToken"),
    );
  }
  return write(store, {
    ...record,
    status: "published",
    lease: undefined,
    nextAttemptAt: undefined,
    receipt,
    publishedAt: receipt.publishedAt,
    updatedAt: at,
  });
}

export async function markChangeProofPublicationPublished(
  input: MarkChangeProofPublicationPublishedInput,
): Promise<ChangeProofPublicationOutboxRecord> {
  return withControlStore((store) => markChangeProofPublicationPublishedInStore(store, input));
}

/** Reconcile a provider success that was durably acknowledged by the
 * provider-boundary receipt writer before the worker process crashed. The
 * existing receipt log is authoritative; no new provider side effect occurs. */
export async function reconcileChangeProofPublicationOutbox(
  input: ChangeProofPublicationScope & { id: string; at?: number },
): Promise<ChangeProofPublicationOutboxRecord | undefined> {
  const current = await readChangeProofPublicationOutbox(input, input.id);
  if (!current || current.status === "published") return current;
  const receipts = await readChangeProofPublications(input, current.proofId);
  const receipt = receipts
    .filter(
      (candidate) =>
        candidate.organizationId === current.organizationId &&
        candidate.projectId === current.projectId &&
        candidate.proofVersion === current.proofVersion &&
        candidate.provider === current.provider &&
        candidate.repository === current.repository &&
        candidate.headSha === current.headSha &&
        candidate.externalId === current.externalId &&
        candidate.checkDigest === canonicalSha256(current.check),
    )
    .at(-1);
  if (!receipt) return current;
  return markChangeProofPublicationPublished({
    organizationId: current.organizationId,
    projectId: current.projectId,
    id: current.id,
    receipt,
    at: input.at,
    ...(current.lease ? { workerId: current.lease.workerId, leaseToken: current.lease.token } : {}),
  });
}

/** Safe startup recovery: an expired claim is made retryable, never silently
 * discarded. A claim at the attempt ceiling stays visible as `retry` but is
 * not automatically claimed again. */
export function recoverChangeProofPublicationOutboxInStore(
  store: ControlStore,
  input: { scope?: ChangeProofPublicationScope; at?: number } = {},
): ChangeProofPublicationOutboxRecord[] {
  return recoverExpiredInStore(store, input.scope, timestamp(input.at ?? Date.now(), "at"));
}

export async function recoverChangeProofPublicationOutbox(
  input: { scope?: ChangeProofPublicationScope; at?: number } = {},
): Promise<ChangeProofPublicationOutboxRecord[]> {
  return withControlStore((store) => recoverChangeProofPublicationOutboxInStore(store, input));
}

/** Provider-neutral worker loop. The server supplies a callback that invokes
 * the existing `publishChangeProofToGitHub` adapter; this module owns only
 * durable claim/retry/reconciliation state and never receives credentials. */
export async function runNextChangeProofPublicationOutbox(
  input: ClaimChangeProofPublicationInput & {
    publish: ChangeProofPublicationExecutor;
    heartbeatMs?: number;
  },
): Promise<ChangeProofPublicationOutboxWorkerResult> {
  const claimed = await claimChangeProofPublicationOutbox(input);
  if (!claimed) return { status: "idle" };
  try {
    const receipt = await withChangeProofPublicationLeaseHeartbeat(
      {
        organizationId: claimed.organizationId,
        projectId: claimed.projectId,
        id: claimed.id,
        workerId: claimed.lease!.workerId,
        leaseToken: claimed.lease!.token,
        ...(input.leaseMs !== undefined ? { leaseMs: input.leaseMs } : {}),
        ...(input.heartbeatMs !== undefined ? { heartbeatMs: input.heartbeatMs } : {}),
      },
      () => input.publish(changeProofPublicationIntentFromOutboxRecord(claimed)),
    );
    const published = await markChangeProofPublicationPublished({
      organizationId: claimed.organizationId,
      projectId: claimed.projectId,
      id: claimed.id,
      workerId: claimed.lease!.workerId,
      leaseToken: claimed.lease!.token,
      receipt,
      at: input.now,
    });
    return { status: "published", record: published };
  } catch {
    const retry = await markChangeProofPublicationRetry({
      organizationId: claimed.organizationId,
      projectId: claimed.projectId,
      id: claimed.id,
      workerId: claimed.lease!.workerId,
      leaseToken: claimed.lease!.token,
      at: input.now,
    });
    return { status: "retry", record: retry };
  }
}

/** Alias emphasizing that this is the durable coordinator's worker entry
 * point; retained separately from the one-at-a-time operation for callers
 * that want a descriptive name. */
export const processNextChangeProofPublication = runNextChangeProofPublicationOutbox;
