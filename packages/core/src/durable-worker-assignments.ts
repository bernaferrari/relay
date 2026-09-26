/**
 * Durable, local-only execution assignment journal.
 *
 * Relay's run manifests are intentionally terminal-only: a `.complete` marker
 * means the run has reached a durable verdict. This journal covers the other
 * half of the lifecycle without persisting an executable recipe, private input,
 * or a provider credential. It records which provider-scoped target was
 * admitted to which lane, the lease provenance frozen at admission, and the
 * last worker heartbeat. On a new server process, active records are resolved
 * to `recovery-required` rather than being replayed blindly against a device
 * whose visible state may have changed while Relay was down.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  executionTargetRefKey,
  isExecutionTargetRef,
  type ExecutionTargetRef,
} from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";

export const DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION = 1 as const;

const ACTIVE_STATUSES = ["queued", "running", "paused"] as const;
const TERMINAL_STATUSES = ["ok", "error", "healed", "cancelled", "recovery-required"] as const;

export type DurableWorkerAssignmentStatus =
  | (typeof ACTIVE_STATUSES)[number]
  | (typeof TERMINAL_STATUSES)[number];

export type DurableWorkerAssignmentTerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type DurableWorkerAssignmentTerminalReason =
  | "job-finished"
  | "job-cancelled"
  /** A scheduler lost the cross-process execution race before it sent input. */
  | "job-dispatch-failed-before-execution"
  /** An immutable, committed run manifest survived a process boundary before
   * the journal could record the same terminal verdict. */
  | "committed-run-manifest"
  | "server-restart-before-dispatch"
  | "server-restart-during-execution";

export type DurableWorkerAssignmentLease = {
  leaseId: string;
  ownerId: string;
  actorId: string;
};

export type DurableWorkerAssignmentLane = {
  workerId: string;
  capacity: number;
  host?: {
    workerId: string;
    capacity: number;
  };
};

export type DurableWorkerAssignmentExecution = {
  /** Unique server-process identity, never a target lane id. */
  workerInstanceId: string;
  claimedAt: number;
  heartbeatAt: number;
};

export type DurableWorkerAssignmentTerminal = {
  status: DurableWorkerAssignmentTerminalStatus;
  at: number;
  reason: DurableWorkerAssignmentTerminalReason;
};

/**
 * A stale in-flight assignment remains a target/host fence until a caller has
 * independently re-proven the target's state. Releasing a fence never erases
 * the interrupted assignment or its terminal evidence.
 */
export type DurableWorkerAssignmentRecoveryFenceRelease = {
  releasedAt: number;
  releasedBy: string;
  reproofId: string;
};

export type DurableWorkerAssignment = {
  schemaVersion: typeof DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION;
  id: string;
  projectId?: string;
  /** Provider-scoped immutable target identity. No endpoint or credential lives here. */
  executionTarget: ExecutionTargetRef;
  /** Persisted only to make accidental cross-provider lane collisions diagnosable. */
  executionTargetKey: string;
  lane: DurableWorkerAssignmentLane;
  lease?: DurableWorkerAssignmentLease;
  status: DurableWorkerAssignmentStatus;
  queuedAt: number;
  execution?: DurableWorkerAssignmentExecution;
  terminal?: DurableWorkerAssignmentTerminal;
  recoveryFenceRelease?: DurableWorkerAssignmentRecoveryFenceRelease;
  updatedAt: number;
};

export type QueueDurableWorkerAssignmentInput = {
  id: string;
  projectId?: string;
  executionTarget: ExecutionTargetRef;
  lane: DurableWorkerAssignmentLane;
  lease?: DurableWorkerAssignmentLease;
  queuedAt?: number;
};

export type DurableWorkerAssignmentReconciliation = {
  assignments: DurableWorkerAssignment[];
  reconciledAt: number;
};

/**
 * Thrown before a scheduler can execute when another Relay process already
 * owns the same physical target or consumes the frozen host ceiling. This is
 * deliberately a recoverable admission outcome, never a reason to send a
 * second input and hope the in-memory schedulers agree.
 */
export class DurableWorkerAssignmentContentionError extends Error {
  readonly code = "DURABLE_WORKER_ASSIGNMENT_CONTENDED" as const;

  constructor(
    readonly scope: "target" | "host",
    readonly assignmentId: string,
    readonly blockingAssignmentId: string,
    readonly blockingStatus?: DurableWorkerAssignmentStatus,
  ) {
    super(
      scope === "target"
        ? blockingStatus === "recovery-required"
          ? `Durable worker target has a recovery-required fence from assignment ${blockingAssignmentId}. Recover the serial with recoveryFenceAssignmentId before the next job.`
          : `Durable worker target is already executing assignment ${blockingAssignmentId}`
        : `Durable worker host capacity is already occupied by assignment ${blockingAssignmentId}`,
    );
    this.name = "DurableWorkerAssignmentContentionError";
  }
}

const ASSIGNMENTS_DB_NAME = "worker-assignments.sqlite";
const ASSIGNMENT_TABLE = "durable_worker_assignments";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Durable worker assignment ${field} is required`);
  }
  return value.trim();
}

function finiteTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Durable worker assignment ${field} must be a timestamp`);
  }
  return value;
}

function positiveCapacity(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`Durable worker assignment ${field} must be a positive capacity`);
  }
  return Math.floor(value);
}

function isStatus(value: unknown): value is DurableWorkerAssignmentStatus {
  return (
    typeof value === "string" &&
    [...ACTIVE_STATUSES, ...TERMINAL_STATUSES].includes(value as DurableWorkerAssignmentStatus)
  );
}

function isTerminalStatus(value: unknown): value is DurableWorkerAssignmentTerminalStatus {
  return typeof value === "string" && TERMINAL_STATUSES.includes(value as never);
}

function isTerminalReason(value: unknown): value is DurableWorkerAssignmentTerminalReason {
  return (
    value === "job-finished" ||
    value === "job-cancelled" ||
    value === "job-dispatch-failed-before-execution" ||
    value === "committed-run-manifest" ||
    value === "server-restart-before-dispatch" ||
    value === "server-restart-during-execution"
  );
}

function normalizeLane(value: DurableWorkerAssignmentLane): DurableWorkerAssignmentLane {
  const host = value.host
    ? {
        workerId: nonEmpty(value.host.workerId, "lane.host.workerId"),
        capacity: positiveCapacity(value.host.capacity, "lane.host.capacity"),
      }
    : undefined;
  return {
    workerId: nonEmpty(value.workerId, "lane.workerId"),
    capacity: positiveCapacity(value.capacity, "lane.capacity"),
    ...(host ? { host } : {}),
  };
}

function normalizeLease(
  value: DurableWorkerAssignmentLease | undefined,
): DurableWorkerAssignmentLease | undefined {
  if (!value) return undefined;
  return {
    leaseId: nonEmpty(value.leaseId, "lease.leaseId"),
    ownerId: nonEmpty(value.ownerId, "lease.ownerId"),
    actorId: nonEmpty(value.actorId, "lease.actorId"),
  };
}

function normalizeAssignment(value: unknown): DurableWorkerAssignment {
  if (!isRecord(value)) throw new Error("Durable worker assignment document must be an object");
  if (value.schemaVersion !== DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION) {
    throw new Error("Unsupported durable worker assignment schema version");
  }
  if (!isExecutionTargetRef(value.executionTarget)) {
    throw new Error("Durable worker assignment execution target is invalid");
  }
  if (!isRecord(value.lane)) throw new Error("Durable worker assignment lane is invalid");
  const lane = normalizeLane(value.lane as DurableWorkerAssignmentLane);
  const status = value.status;
  if (!isStatus(status)) throw new Error("Durable worker assignment status is invalid");
  const execution = value.execution;
  let normalizedExecution: DurableWorkerAssignmentExecution | undefined;
  if (execution !== undefined) {
    if (!isRecord(execution)) throw new Error("Durable worker assignment execution is invalid");
    normalizedExecution = {
      workerInstanceId: nonEmpty(execution.workerInstanceId, "execution.workerInstanceId"),
      claimedAt: finiteTimestamp(execution.claimedAt, "execution.claimedAt"),
      heartbeatAt: finiteTimestamp(execution.heartbeatAt, "execution.heartbeatAt"),
    };
  }
  const terminal = value.terminal;
  let normalizedTerminal: DurableWorkerAssignmentTerminal | undefined;
  if (terminal !== undefined) {
    if (!isRecord(terminal) || !isTerminalStatus(terminal.status)) {
      throw new Error("Durable worker assignment terminal status is invalid");
    }
    if (!isTerminalReason(terminal.reason)) {
      throw new Error("Durable worker assignment terminal reason is invalid");
    }
    normalizedTerminal = {
      status: terminal.status,
      at: finiteTimestamp(terminal.at, "terminal.at"),
      reason: terminal.reason,
    };
  }
  if (ACTIVE_STATUSES.includes(status as never) && normalizedTerminal) {
    throw new Error("Active durable worker assignment cannot contain a terminal outcome");
  }
  if (TERMINAL_STATUSES.includes(status as never) && !normalizedTerminal) {
    throw new Error("Terminal durable worker assignment requires a terminal outcome");
  }
  if ((status === "running" || status === "paused") && !normalizedExecution) {
    throw new Error("Running durable worker assignment requires worker ownership");
  }
  const recoveryFenceRelease = value.recoveryFenceRelease;
  let normalizedRecoveryFenceRelease: DurableWorkerAssignmentRecoveryFenceRelease | undefined;
  if (recoveryFenceRelease !== undefined) {
    if (!isRecord(recoveryFenceRelease)) {
      throw new Error("Durable worker assignment recovery fence release is invalid");
    }
    if (status !== "recovery-required" || !normalizedExecution) {
      throw new Error("Only a recovered in-flight assignment can release its resource fence");
    }
    normalizedRecoveryFenceRelease = {
      releasedAt: finiteTimestamp(
        recoveryFenceRelease.releasedAt,
        "recoveryFenceRelease.releasedAt",
      ),
      releasedBy: nonEmpty(recoveryFenceRelease.releasedBy, "recoveryFenceRelease.releasedBy"),
      reproofId: nonEmpty(recoveryFenceRelease.reproofId, "recoveryFenceRelease.reproofId"),
    };
  }
  const lease = value.lease;
  if (lease !== undefined && !isRecord(lease)) {
    throw new Error("Durable worker assignment lease is invalid");
  }
  const target = structuredClone(value.executionTarget);
  const targetKey = executionTargetRefKey(target);
  if (value.executionTargetKey !== targetKey) {
    throw new Error("Durable worker assignment target key does not match its target");
  }
  return {
    schemaVersion: DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION,
    id: nonEmpty(value.id, "id"),
    ...(typeof value.projectId === "string" && value.projectId.trim()
      ? { projectId: value.projectId.trim() }
      : {}),
    executionTarget: target,
    executionTargetKey: targetKey,
    lane,
    ...(lease ? { lease: normalizeLease(lease as DurableWorkerAssignmentLease)! } : {}),
    status,
    queuedAt: finiteTimestamp(value.queuedAt, "queuedAt"),
    ...(normalizedExecution ? { execution: normalizedExecution } : {}),
    ...(normalizedTerminal ? { terminal: normalizedTerminal } : {}),
    ...(normalizedRecoveryFenceRelease
      ? { recoveryFenceRelease: normalizedRecoveryFenceRelease }
      : {}),
    updatedAt: finiteTimestamp(value.updatedAt, "updatedAt"),
  };
}

function cloneAssignment(value: DurableWorkerAssignment): DurableWorkerAssignment {
  return structuredClone(value);
}

function sameQueuedAssignment(
  existing: DurableWorkerAssignment,
  candidate: DurableWorkerAssignment,
): boolean {
  return (
    existing.status === "queued" &&
    existing.projectId === candidate.projectId &&
    existing.executionTargetKey === candidate.executionTargetKey &&
    JSON.stringify(existing.executionTarget) === JSON.stringify(candidate.executionTarget) &&
    JSON.stringify(existing.lane) === JSON.stringify(candidate.lane) &&
    JSON.stringify(existing.lease) === JSON.stringify(candidate.lease) &&
    existing.queuedAt === candidate.queuedAt
  );
}

function assignmentStateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

export function durableWorkerAssignmentsPath(root = assignmentStateRoot()): string {
  return join(root, ASSIGNMENTS_DB_NAME);
}

/** A small synchronous journal: queue admission must be committed before the
 * in-memory scheduler is allowed to send input to a target. SQLite's WAL mode
 * lets a future local supervisor inspect it without holding an in-process map. */
export class DurableWorkerAssignmentStore {
  readonly #db: DatabaseSync;
  #closed = false;

  constructor(readonly path = durableWorkerAssignmentsPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path, { timeout: 5_000 });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      -- Queue admission is the last durable fence before a scheduler can
      -- send physical input. Favor a confirmed WAL commit over the small
      -- write-latency gain from NORMAL, which may lose recent transactions
      -- across host power loss.
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
    `);
    this.#initialize();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  queue(input: QueueDurableWorkerAssignmentInput): DurableWorkerAssignment {
    const queuedAt = finiteTimestamp(input.queuedAt ?? Date.now(), "queuedAt");
    if (!isExecutionTargetRef(input.executionTarget)) {
      throw new Error("Durable worker assignment execution target is invalid");
    }
    const candidate: DurableWorkerAssignment = {
      schemaVersion: DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION,
      id: nonEmpty(input.id, "id"),
      ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
      executionTarget: structuredClone(input.executionTarget),
      executionTargetKey: executionTargetRefKey(input.executionTarget),
      lane: normalizeLane(input.lane),
      ...(input.lease ? { lease: normalizeLease(input.lease)! } : {}),
      status: "queued",
      queuedAt,
      updatedAt: queuedAt,
    };
    return this.#transaction(() => {
      const existing = this.#read(candidate.id);
      if (existing) {
        if (sameQueuedAssignment(existing, candidate)) return cloneAssignment(existing);
        throw new Error(`Durable worker assignment ${candidate.id} already exists`);
      }
      this.#write(candidate);
      return cloneAssignment(candidate);
    });
  }

  get(id: string): DurableWorkerAssignment | undefined {
    return this.#read(nonEmpty(id, "id"));
  }

  list(): DurableWorkerAssignment[] {
    const rows = this.#db
      .prepare(`SELECT document FROM ${ASSIGNMENT_TABLE} ORDER BY queued_at ASC, id ASC`)
      .all() as Array<{ document: string }>;
    return rows.map((row) => normalizeAssignment(JSON.parse(row.document) as unknown));
  }

  claimRunning(id: string, workerInstanceId: string, at = Date.now()): DurableWorkerAssignment {
    const normalizedId = nonEmpty(id, "id");
    const owner = nonEmpty(workerInstanceId, "execution.workerInstanceId");
    const claimedAt = finiteTimestamp(at, "execution.claimedAt");
    return this.#transaction(() => {
      const current = this.#required(normalizedId);
      if (current.status === "running" && current.execution?.workerInstanceId === owner) {
        const next = {
          ...current,
          execution: { ...current.execution, heartbeatAt: claimedAt },
          updatedAt: claimedAt,
        };
        this.#write(next);
        return cloneAssignment(next);
      }
      if (current.status !== "queued") {
        throw new Error(`Durable worker assignment ${normalizedId} is not queued`);
      }
      this.#assertExecutionLaneAvailable(current);
      const next: DurableWorkerAssignment = {
        ...current,
        status: "running",
        execution: { workerInstanceId: owner, claimedAt, heartbeatAt: claimedAt },
        updatedAt: claimedAt,
      };
      this.#write(next);
      return cloneAssignment(next);
    });
  }

  heartbeat(id: string, workerInstanceId: string, at = Date.now()): DurableWorkerAssignment {
    const normalizedId = nonEmpty(id, "id");
    const owner = nonEmpty(workerInstanceId, "execution.workerInstanceId");
    const heartbeatAt = finiteTimestamp(at, "execution.heartbeatAt");
    return this.#transaction(() => {
      const current = this.#required(normalizedId);
      this.#requireWorkerOwner(current, owner);
      if (current.status !== "running" && current.status !== "paused") {
        throw new Error(`Durable worker assignment ${normalizedId} is not active`);
      }
      const next: DurableWorkerAssignment = {
        ...current,
        execution: { ...current.execution!, heartbeatAt },
        updatedAt: heartbeatAt,
      };
      this.#write(next);
      return cloneAssignment(next);
    });
  }

  setPaused(
    id: string,
    workerInstanceId: string,
    paused: boolean,
    at = Date.now(),
  ): DurableWorkerAssignment {
    const normalizedId = nonEmpty(id, "id");
    const owner = nonEmpty(workerInstanceId, "execution.workerInstanceId");
    const updatedAt = finiteTimestamp(at, "updatedAt");
    return this.#transaction(() => {
      const current = this.#required(normalizedId);
      this.#requireWorkerOwner(current, owner);
      const expected = paused ? "running" : "paused";
      if (current.status !== expected) {
        throw new Error(`Durable worker assignment ${normalizedId} cannot change pause state`);
      }
      const next: DurableWorkerAssignment = {
        ...current,
        status: paused ? "paused" : "running",
        execution: { ...current.execution!, heartbeatAt: updatedAt },
        updatedAt,
      };
      this.#write(next);
      return cloneAssignment(next);
    });
  }

  finish(input: {
    id: string;
    status: Exclude<DurableWorkerAssignmentTerminalStatus, "recovery-required">;
    workerInstanceId?: string;
    at?: number;
  }): DurableWorkerAssignment {
    const id = nonEmpty(input.id, "id");
    const at = finiteTimestamp(input.at ?? Date.now(), "terminal.at");
    const owner = input.workerInstanceId
      ? nonEmpty(input.workerInstanceId, "execution.workerInstanceId")
      : undefined;
    return this.#transaction(() => {
      const current = this.#required(id);
      if (TERMINAL_STATUSES.includes(current.status as never)) {
        if (current.status === input.status) return cloneAssignment(current);
        throw new Error(`Durable worker assignment ${id} already has a terminal outcome`);
      }
      if (current.status !== "queued" && !owner) {
        throw new Error(`Durable worker assignment ${id} requires worker ownership to finish`);
      }
      if (owner) this.#requireWorkerOwner(current, owner);
      if (current.status === "queued" && input.status !== "cancelled" && input.status !== "error") {
        throw new Error(`Queued durable worker assignment ${id} can only be cancelled or rejected`);
      }
      const next: DurableWorkerAssignment = {
        ...current,
        status: input.status,
        terminal: {
          status: input.status,
          at,
          reason:
            input.status === "cancelled"
              ? "job-cancelled"
              : current.status === "queued"
                ? "job-dispatch-failed-before-execution"
                : "job-finished",
        },
        updatedAt: at,
      };
      this.#write(next);
      return cloneAssignment(next);
    });
  }

  /**
   * Reconcile a crash after the immutable run manifest committed but before
   * its matching journal terminal row could be written. The manifest is the
   * execution verdict; `recovery-required` is only a quarantine state and may
   * therefore be replaced by that verdict. Concrete journal outcomes are
   * never silently rewritten when they disagree with the committed manifest.
   */
  finishFromCommittedRunManifest(input: {
    id: string;
    status: Exclude<DurableWorkerAssignmentTerminalStatus, "recovery-required">;
    at?: number;
  }): DurableWorkerAssignment {
    const id = nonEmpty(input.id, "id");
    const at = finiteTimestamp(input.at ?? Date.now(), "terminal.at");
    return this.#transaction(() => {
      const current = this.#required(id);
      if (
        TERMINAL_STATUSES.includes(current.status as never) &&
        current.status !== "recovery-required"
      ) {
        if (current.status === input.status) return cloneAssignment(current);
        throw new Error(
          `Durable worker assignment ${id} conflicts with its committed run manifest`,
        );
      }
      const next: DurableWorkerAssignment = {
        ...current,
        status: input.status,
        terminal: {
          status: input.status,
          at,
          reason: "committed-run-manifest",
        },
        updatedAt: at,
      };
      this.#write(next);
      return cloneAssignment(next);
    });
  }

  /**
   * Explicitly release the durable resource fence left by a process-boundary
   * interruption. Callers must provide a stable identifier for the fresh
   * source reproof; a blind restart or timer is intentionally insufficient.
   */
  releaseRecoveryFence(input: {
    id: string;
    releasedBy: string;
    reproofId: string;
    at?: number;
  }): DurableWorkerAssignment {
    const id = nonEmpty(input.id, "id");
    const releasedAt = finiteTimestamp(input.at ?? Date.now(), "recoveryFenceRelease.releasedAt");
    const releasedBy = nonEmpty(input.releasedBy, "recoveryFenceRelease.releasedBy");
    const reproofId = nonEmpty(input.reproofId, "recoveryFenceRelease.reproofId");
    return this.#transaction(() => {
      const current = this.#required(id);
      if (current.status !== "recovery-required" || !current.execution) {
        throw new Error(`Durable worker assignment ${id} has no recoverable execution fence`);
      }
      if (current.recoveryFenceRelease) {
        if (
          current.recoveryFenceRelease.releasedBy === releasedBy &&
          current.recoveryFenceRelease.reproofId === reproofId
        ) {
          return cloneAssignment(current);
        }
        throw new Error(`Durable worker assignment ${id} recovery fence was already released`);
      }
      const next: DurableWorkerAssignment = {
        ...current,
        recoveryFenceRelease: { releasedAt, releasedBy, reproofId },
        updatedAt: releasedAt,
      };
      this.#write(next);
      return cloneAssignment(next);
    });
  }

  /**
   * Converge active assignments written by a previous server process. This is
   * deliberately a terminal recovery verdict, not an automatic retry: pixels,
   * UI state, and lease authority can all have changed while the process was
   * absent. The original target and lease facts remain queryable for an explicit
   * replay/review path.
   */
  reconcileAfterRestart(input: {
    workerInstanceId: string;
    at?: number;
    /** Restrict recovery to the startup snapshot that was manifest-checked.
     * This keeps a newly admitted job from being mistaken for pre-restart work
     * while asynchronous manifest reads are in progress. */
    assignmentIds?: readonly string[];
  }): DurableWorkerAssignmentReconciliation {
    const workerInstanceId = nonEmpty(input.workerInstanceId, "execution.workerInstanceId");
    const reconciledAt = finiteTimestamp(input.at ?? Date.now(), "reconciledAt");
    const assignmentIds = input.assignmentIds
      ? new Set(input.assignmentIds.map((id) => nonEmpty(id, "id")))
      : undefined;
    return this.#transaction(() => {
      const assignments = assignmentIds
        ? [...assignmentIds]
            .map((id) => this.#read(id))
            .filter((assignment): assignment is DurableWorkerAssignment => Boolean(assignment))
        : this.list();
      const reconciled: DurableWorkerAssignment[] = [];
      for (const current of assignments) {
        if (!ACTIVE_STATUSES.includes(current.status as never)) continue;
        // Re-invoking recovery in the same live process is a no-op. A queued
        // record has no owner, so it is necessarily from before this process.
        if (current.execution?.workerInstanceId === workerInstanceId) continue;
        const next: DurableWorkerAssignment = {
          ...current,
          status: "recovery-required",
          terminal: {
            status: "recovery-required",
            at: reconciledAt,
            reason:
              current.status === "queued"
                ? "server-restart-before-dispatch"
                : "server-restart-during-execution",
          },
          updatedAt: reconciledAt,
        };
        this.#write(next);
        reconciled.push(cloneAssignment(next));
      }
      return { assignments: reconciled, reconciledAt };
    });
  }

  #initialize(): void {
    const row = this.#db.prepare("PRAGMA user_version").get() as
      | { user_version?: number }
      | undefined;
    const version = Number(row?.user_version ?? 0);
    if (version > DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION) {
      throw new Error("Durable worker assignment database is newer than this Relay build");
    }
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${ASSIGNMENT_TABLE} (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS durable_worker_assignments_status_updated
        ON ${ASSIGNMENT_TABLE}(status, updated_at);
    `);
    if (version < DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION) {
      this.#db.exec(`PRAGMA user_version = ${DURABLE_WORKER_ASSIGNMENT_SCHEMA_VERSION}`);
    }
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        /* Ignore a rollback after a failed BEGIN. */
      }
      throw error;
    }
  }

  #read(id: string): DurableWorkerAssignment | undefined {
    const row = this.#db
      .prepare(`SELECT document FROM ${ASSIGNMENT_TABLE} WHERE id = ?`)
      .get(id) as { document?: string } | undefined;
    return row?.document ? normalizeAssignment(JSON.parse(row.document) as unknown) : undefined;
  }

  #required(id: string): DurableWorkerAssignment {
    const assignment = this.#read(id);
    if (!assignment) throw new Error(`Durable worker assignment ${id} was not found`);
    return assignment;
  }

  #write(assignment: DurableWorkerAssignment): void {
    const document = JSON.stringify(assignment);
    this.#db
      .prepare(
        `INSERT INTO ${ASSIGNMENT_TABLE}(id, status, queued_at, updated_at, document)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           queued_at = excluded.queued_at,
           updated_at = excluded.updated_at,
           document = excluded.document`,
      )
      .run(assignment.id, assignment.status, assignment.queuedAt, assignment.updatedAt, document);
  }

  /**
   * SQLite serializes this check and the status transition in one immediate
   * transaction. In-memory TargetWorkerSchedulers therefore remain a
   * throughput optimization, not the authority that keeps two Relay server
   * processes from driving one target concurrently.
   */
  #assertExecutionLaneAvailable(candidate: DurableWorkerAssignment): void {
    const active = (
      this.#db
        .prepare(
          `SELECT document FROM ${ASSIGNMENT_TABLE}
           WHERE id != ? AND status IN ('running', 'paused', 'recovery-required')
           ORDER BY queued_at ASC, id ASC`,
        )
        .all(candidate.id) as Array<{ document: string }>
    )
      .map((row) => normalizeAssignment(JSON.parse(row.document) as unknown))
      .filter(
        (assignment) =>
          assignment.status === "running" ||
          assignment.status === "paused" ||
          (assignment.status === "recovery-required" &&
            Boolean(assignment.execution) &&
            !assignment.recoveryFenceRelease &&
            // A managed browser starts clean for the next job; only a device
            // left mid-action needs a person to look before reuse. The
            // recovery verdict stays on record either way.
            assignment.executionTarget.kind !== "local-browser"),
      );
    const targetOwner = active.find(
      (assignment) =>
        assignment.lane.workerId === candidate.lane.workerId ||
        (assignment.executionTargetKey === candidate.executionTargetKey &&
          assignment.executionTarget.kind !== "local-browser" &&
          candidate.executionTarget.kind !== "local-browser"),
    );
    if (targetOwner) {
      throw new DurableWorkerAssignmentContentionError(
        "target",
        candidate.id,
        targetOwner.id,
        targetOwner.status,
      );
    }

    const host = candidate.lane.host;
    if (!host) return;
    const hostOwners = active.filter(
      (assignment) => assignment.lane.host?.workerId === host.workerId,
    );
    if (!hostOwners.length) return;
    // A mismatched local configuration must never silently raise a shared
    // physical-host limit. The lowest frozen capacity is the safe ceiling.
    const effectiveCapacity = Math.min(
      host.capacity,
      ...hostOwners.map((assignment) => assignment.lane.host!.capacity),
    );
    if (hostOwners.length >= effectiveCapacity) {
      throw new DurableWorkerAssignmentContentionError("host", candidate.id, hostOwners[0]!.id);
    }
  }

  #requireWorkerOwner(assignment: DurableWorkerAssignment, workerInstanceId: string): void {
    if (assignment.execution?.workerInstanceId !== workerInstanceId) {
      throw new Error(`Durable worker assignment ${assignment.id} is owned by another worker`);
    }
  }
}

let cachedStore: DurableWorkerAssignmentStore | undefined;
let cachedPath: string | undefined;

function createDurableWorkerInstanceId(): string {
  return `relay:${process.pid}:${randomUUID()}`;
}

/**
 * Unique to the active Relay server lifecycle. A process may host a server,
 * close it, and start another one without exiting; that new lifecycle must
 * never treat an interrupted assignment from the previous server as live.
 */
let processWorkerInstanceId = createDurableWorkerInstanceId();

export function currentDurableWorkerInstanceId(): string {
  return processWorkerInstanceId;
}

/** Call only after acquiring a state-directory server lease and before startup
 * recovery. The lease serializes lifecycle rotation across real Relay servers. */
export function beginDurableWorkerServerLifecycle(): string {
  processWorkerInstanceId = createDurableWorkerInstanceId();
  return processWorkerInstanceId;
}

export function durableWorkerAssignmentStore(): DurableWorkerAssignmentStore {
  const path = durableWorkerAssignmentsPath();
  if (cachedStore && cachedPath === path) return cachedStore;
  cachedStore?.close();
  cachedStore = new DurableWorkerAssignmentStore(path);
  cachedPath = path;
  return cachedStore;
}

export function reconcileDurableWorkerAssignments(
  input: {
    workerInstanceId?: string;
    at?: number;
  } = {},
): DurableWorkerAssignmentReconciliation {
  return durableWorkerAssignmentStore().reconcileAfterRestart({
    workerInstanceId: input.workerInstanceId ?? currentDurableWorkerInstanceId(),
    ...(input.at === undefined ? {} : { at: input.at }),
  });
}

/** Test-only cache reset so a temporary state root can be removed safely. */
export function resetDurableWorkerAssignmentStoreForTests(): void {
  cachedStore?.close();
  cachedStore = undefined;
  cachedPath = undefined;
}
