/**
 * Fail-closed ownership of a Relay state directory.
 *
 * Durable worker rows protect individual targets, but a second Relay server
 * must not start recovery while the first server is still alive. Recovery
 * could otherwise quarantine the live worker's journal rows and sever its
 * ability to write a terminal result. This small SQLite lease is acquired
 * before a server performs any device or daemon work.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { findWorkspaceRoot } from "./workspace-root.js";

const LEASE_DATABASE_NAME = "relay-server-lease.sqlite";
// Lease documents are a durable ownership contract. Keep their schema stable
// while the containing SQLite database evolves (for example, audit tables).
const LEASE_DOCUMENT_SCHEMA_VERSION = 1;
const LEASE_DATABASE_SCHEMA_VERSION = 2;
const RECOVERY_AUDIT_SCHEMA_VERSION = 1;
const LEASE_SLOT = "relay-server";
const MINIMUM_ABANDONED_LEASE_AGE_MS = 5 * 60_000;

type PersistedRelayServerLease = {
  schemaVersion: typeof LEASE_DOCUMENT_SCHEMA_VERSION;
  leaseId: string;
  pid: number;
  host: string;
  acquiredAt: number;
};

type PersistedRelayServerLeaseRecoveryAudit = {
  schemaVersion: typeof RECOVERY_AUDIT_SCHEMA_VERSION;
  auditId: string;
  previousOwner: RelayStateServerLeaseOwner;
  recoveredAt: number;
  recoveredByHost: string;
  reason: "local-hostname-collision-renamed" | "legacy-ip-host-recovered";
};

export type RelayStateServerLeaseOwner = Readonly<
  Pick<PersistedRelayServerLease, "leaseId" | "pid" | "host" | "acquiredAt">
>;

export type RelayStateServerLease = {
  readonly path: string;
  readonly owner: RelayStateServerLeaseOwner;
  release(): void;
};

export class RelayStateDirectoryInUseError extends Error {
  readonly code = "RELAY_STATE_DIRECTORY_IN_USE" as const;

  constructor(
    readonly path: string,
    readonly owner: Pick<RelayStateServerLeaseOwner, "pid" | "host">,
    readonly reason: "active-local-process" | "foreign-host",
  ) {
    super(
      reason === "active-local-process"
        ? `Relay state directory is already owned by live Relay process ${owner.pid} on ${owner.host}: ${path}`
        : `Relay state directory is owned by Relay process ${owner.pid} on another host (${owner.host}): ${path}`,
    );
    this.name = "RelayStateDirectoryInUseError";
  }
}

function relayStateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

export function relayStateServerLeasePath(root = relayStateRoot()): string {
  return join(root, LEASE_DATABASE_NAME);
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Relay state server lease ${field} is required`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Relay state server lease ${field} must be a positive integer`);
  }
  return value;
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Relay state server lease ${field} must be a timestamp`);
  }
  return value;
}

function normalizeLease(value: unknown): PersistedRelayServerLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay state server lease document is invalid");
  }
  const lease = value as Record<string, unknown>;
  if (lease.schemaVersion !== LEASE_DOCUMENT_SCHEMA_VERSION) {
    throw new Error("Relay state server lease schema version is unsupported");
  }
  return {
    schemaVersion: LEASE_DOCUMENT_SCHEMA_VERSION,
    leaseId: nonEmpty(lease.leaseId, "leaseId"),
    pid: positiveInteger(lease.pid, "pid"),
    host: nonEmpty(lease.host, "host"),
    acquiredAt: timestamp(lease.acquiredAt, "acquiredAt"),
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    // EPERM proves that a process exists even if this account may not signal it.
    return code === "EPERM";
  }
}

type PersistedRelayServerLeaseRow = Readonly<{
  document: string;
  lease: PersistedRelayServerLease;
}>;

function readLeaseRow(database: DatabaseSync): PersistedRelayServerLeaseRow | undefined {
  const row = database
    .prepare("SELECT document FROM relay_server_state_leases WHERE slot = ?")
    .get(LEASE_SLOT) as { document?: string } | undefined;
  return row?.document
    ? { document: row.document, lease: normalizeLease(JSON.parse(row.document) as unknown) }
    : undefined;
}

function readLease(database: DatabaseSync): PersistedRelayServerLease | undefined {
  return readLeaseRow(database)?.lease;
}

function writeLease(database: DatabaseSync, lease: PersistedRelayServerLease): void {
  database
    .prepare(
      `INSERT INTO relay_server_state_leases(slot, document)
       VALUES(?, ?)
       ON CONFLICT(slot) DO UPDATE SET document = excluded.document`,
    )
    .run(LEASE_SLOT, JSON.stringify(lease));
}

function begin(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The initial BEGIN can fail while another process owns SQLite's writer.
  }
}

function closeDatabase(database: DatabaseSync): void {
  try {
    database.close();
  } catch {
    // A failed cleanup must never mask the startup safety error.
  }
}

function initializeLeaseDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
  `);
  const versionRow = database.prepare("PRAGMA user_version").get() as {
    user_version?: number;
  };
  const schemaVersion = Number(versionRow.user_version ?? 0);
  if (schemaVersion > LEASE_DATABASE_SCHEMA_VERSION) {
    throw new Error("Relay state server lease database is newer than this Relay build");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS relay_server_state_leases (
      slot TEXT PRIMARY KEY,
      document TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_server_state_lease_recovery_audit (
      audit_id TEXT PRIMARY KEY,
      document TEXT NOT NULL
    );
  `);
  if (schemaVersion < LEASE_DATABASE_SCHEMA_VERSION) {
    database.exec(`PRAGMA user_version = ${LEASE_DATABASE_SCHEMA_VERSION}`);
  }
}

/**
 * Own this state directory until `release()` is called. A same-host dead PID
 * may be reclaimed; a live PID or a foreign host is never overridden. That
 * conservative policy avoids pretending a network/shared filesystem provides
 * a distributed worker lease.
 */
export function acquireRelayStateServerLease(
  input: {
    path?: string;
    pid?: number;
    host?: string;
    acquiredAt?: number;
  } = {},
): RelayStateServerLease {
  const path = input.path ?? relayStateServerLeasePath();
  const owner: PersistedRelayServerLease = {
    schemaVersion: LEASE_DOCUMENT_SCHEMA_VERSION,
    leaseId: randomUUID(),
    pid: positiveInteger(input.pid ?? process.pid, "pid"),
    host: nonEmpty(input.host ?? hostname(), "host"),
    acquiredAt: timestamp(input.acquiredAt ?? Date.now(), "acquiredAt"),
  };
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  let acquired = false;
  try {
    initializeLeaseDatabase(database);
    begin(database);
    const existing = readLease(database);
    if (existing) {
      if (existing.host !== owner.host) {
        throw new RelayStateDirectoryInUseError(path, existing, "foreign-host");
      }
      if (isProcessAlive(existing.pid)) {
        throw new RelayStateDirectoryInUseError(path, existing, "active-local-process");
      }
    }
    writeLease(database, owner);
    database.exec("COMMIT");
    acquired = true;
  } catch (error) {
    rollback(database);
    closeDatabase(database);
    throw error;
  }

  let released = false;
  return {
    path,
    owner,
    release() {
      if (released) return;
      released = true;
      if (!acquired) {
        closeDatabase(database);
        return;
      }
      try {
        begin(database);
        const current = readLease(database);
        if (current?.leaseId === owner.leaseId) {
          database.prepare("DELETE FROM relay_server_state_leases WHERE slot = ?").run(LEASE_SLOT);
        }
        database.exec("COMMIT");
      } catch {
        rollback(database);
      } finally {
        closeDatabase(database);
      }
    },
  };
}

export type RecoverAbandonedLocalRelayStateServerLeaseInput = {
  path?: string;
  workspaceRoot?: string;
  currentHost?: string;
  now?: number;
  minimumAgeMs?: number;
  /** `false` is positive evidence that the local Relay port is unoccupied.
   * Omit it when that evidence cannot be collected; recovery then fails closed. */
  localPortHasListener?: boolean;
  /** Positive evidence collected by the workspace-local bootstrap process.
   * Foreign-host recovery is forbidden on shared or unclassified storage. */
  workspaceFilesystem?: "local" | "shared" | "unknown";
};

type RelayStateServerLeaseRecoveryRefusalReason =
  | "owner-process-alive"
  | "lease-not-old-enough"
  | "local-port-listener-present"
  | "local-port-listener-unknown"
  | "foreign-host-not-local-rename"
  | "workspace-filesystem-not-local"
  | "state-not-workspace-local"
  | "no-existing-lease";

export type RelayStateServerLeaseRecovery =
  | {
      readonly status: "recovered";
      readonly reason: "local-hostname-collision-renamed" | "legacy-ip-host-recovered";
      readonly previousOwner: RelayStateServerLeaseOwner;
      readonly recoveredAt: number;
      readonly auditId: string;
    }
  | {
      readonly status: "refused";
      readonly reason: RelayStateServerLeaseRecoveryRefusalReason;
      readonly owner?: Readonly<PersistedRelayServerLease>;
    };

export type RelayStateServerLeaseRecoveryAudit = Readonly<
  Omit<PersistedRelayServerLeaseRecoveryAudit, "schemaVersion">
>;

function isLocalHostnameRenamed(previous: string, current: string): boolean {
  const collisionHostname = /^(.+?)(?:-(\d+))?\.local$/i;
  const previousMatch = collisionHostname.exec(previous.trim());
  const currentMatch = collisionHostname.exec(current.trim());
  if (!previousMatch || !currentMatch || previous.toLowerCase() === current.toLowerCase())
    return false;
  const previousBase = previousMatch[1]?.toLowerCase();
  const currentBase = currentMatch[1]?.toLowerCase();
  // A suffix is deliberately required: equal host bases alone do not prove a
  // hostname collision and are too weak a reason to take a foreign lease.
  return (
    previousBase !== undefined &&
    previousBase === currentBase &&
    (previousMatch[2] !== undefined || currentMatch[2] !== undefined)
  );
}

function recoveryReasonForForeignHost(
  previous: string,
  current: string,
): PersistedRelayServerLeaseRecoveryAudit["reason"] | undefined {
  if (isLocalHostnameRenamed(previous, current)) return "local-hostname-collision-renamed";
  // Older local builds persisted the machine's transient IP address as the
  // lease host. A stable hostname is stronger owner evidence, but replacing
  // one IP address with another would merely exchange one ambiguous identity
  // for another and therefore remains forbidden.
  if (isIP(previous.trim()) !== 0 && isIP(current.trim()) === 0) {
    return "legacy-ip-host-recovered";
  }
  return undefined;
}

/**
 * Reclaim a stale foreign-host lease only when a proven local identity
 * migration, a dead owner PID, sufficient age, and a known-empty local port
 * all agree.
 * The exact row is compare-and-deleted and its audit record is written in the
 * same IMMEDIATE transaction. Anything less certain fails closed.
 */
export function recoverAbandonedLocalRelayStateServerLease(
  input: RecoverAbandonedLocalRelayStateServerLeaseInput = {},
): RelayStateServerLeaseRecovery {
  const path = input.path ?? relayStateServerLeasePath();
  const workspaceRoot = input.workspaceRoot ?? findWorkspaceRoot();
  const currentHost = nonEmpty(input.currentHost ?? hostname(), "currentHost");
  const now = timestamp(input.now ?? Date.now(), "now");
  const minimumAgeMs = timestamp(
    input.minimumAgeMs ?? MINIMUM_ABANDONED_LEASE_AGE_MS,
    "minimumAgeMs",
  );

  const stateRoot = join(workspaceRoot, ".relay");
  if (dirname(path) !== stateRoot || !path.endsWith(LEASE_DATABASE_NAME)) {
    return { status: "refused", reason: "state-not-workspace-local" };
  }

  mkdirSync(stateRoot, { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  try {
    initializeLeaseDatabase(database);
    begin(database);
    const existingRow = readLeaseRow(database);
    if (!existingRow) {
      rollback(database);
      return { status: "refused", reason: "no-existing-lease" };
    }
    const owner = existingRow.lease;
    const refuse = (
      reason: RelayStateServerLeaseRecoveryRefusalReason,
    ): RelayStateServerLeaseRecovery => {
      rollback(database);
      return { status: "refused", reason, owner };
    };
    if (isProcessAlive(owner.pid)) return refuse("owner-process-alive");
    if (input.workspaceFilesystem !== "local") {
      return refuse("workspace-filesystem-not-local");
    }
    if (input.localPortHasListener === true) return refuse("local-port-listener-present");
    if (input.localPortHasListener !== false) return refuse("local-port-listener-unknown");
    if (now - owner.acquiredAt < minimumAgeMs) return refuse("lease-not-old-enough");
    const recoveryReason = recoveryReasonForForeignHost(owner.host, currentHost);
    if (!recoveryReason) {
      return refuse("foreign-host-not-local-rename");
    }
    const audit: PersistedRelayServerLeaseRecoveryAudit = {
      schemaVersion: RECOVERY_AUDIT_SCHEMA_VERSION,
      auditId: randomUUID(),
      previousOwner: owner,
      recoveredAt: now,
      recoveredByHost: currentHost,
      reason: recoveryReason,
    };
    const deleted = database
      .prepare("DELETE FROM relay_server_state_leases WHERE slot = ? AND document = ?")
      .run(LEASE_SLOT, existingRow.document);
    if (Number(deleted.changes) !== 1) {
      rollback(database);
      return { status: "refused", reason: "foreign-host-not-local-rename", owner };
    }
    database
      .prepare(
        "INSERT INTO relay_server_state_lease_recovery_audit(audit_id, document) VALUES(?, ?)",
      )
      .run(audit.auditId, JSON.stringify(audit));
    database.exec("COMMIT");
    return {
      status: "recovered",
      reason: audit.reason,
      previousOwner: owner,
      recoveredAt: now,
      auditId: audit.auditId,
    };
  } catch (error) {
    rollback(database);
    throw error;
  } finally {
    closeDatabase(database);
  }
}

/** Read-only evidence for local bootstrap diagnostics and tests. */
export function relayStateServerLeaseRecoveryAudit(
  input: { path?: string } = {},
): readonly RelayStateServerLeaseRecoveryAudit[] {
  const path = input.path ?? relayStateServerLeasePath();
  const database = new DatabaseSync(path, { timeout: 5_000, readOnly: true });
  try {
    return (
      database
        .prepare("SELECT document FROM relay_server_state_lease_recovery_audit ORDER BY rowid ASC")
        .all() as unknown as readonly { document: string }[]
    ).map((row): RelayStateServerLeaseRecoveryAudit => {
      const value = JSON.parse(row.document) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Relay state server lease recovery audit document is invalid");
      }
      const audit = value as Record<string, unknown>;
      if (audit.schemaVersion !== RECOVERY_AUDIT_SCHEMA_VERSION) {
        throw new Error("Relay state server lease recovery audit schema version is unsupported");
      }
      const previousOwner = audit.previousOwner;
      if (!previousOwner || typeof previousOwner !== "object" || Array.isArray(previousOwner)) {
        throw new Error("Relay state server lease recovery audit previousOwner is invalid");
      }
      return {
        auditId: nonEmpty(audit.auditId, "recovery audit auditId"),
        previousOwner: normalizeLease({
          schemaVersion: LEASE_DOCUMENT_SCHEMA_VERSION,
          ...(previousOwner as Record<string, unknown>),
        }),
        recoveredAt: timestamp(audit.recoveredAt, "recovery audit recoveredAt"),
        recoveredByHost: nonEmpty(audit.recoveredByHost, "recovery audit recoveredByHost"),
        reason: (() => {
          if (
            audit.reason !== "local-hostname-collision-renamed" &&
            audit.reason !== "legacy-ip-host-recovered"
          ) {
            throw new Error("Relay state server lease recovery audit reason is invalid");
          }
          return audit.reason;
        })(),
      };
    });
  } finally {
    closeDatabase(database);
  }
}
