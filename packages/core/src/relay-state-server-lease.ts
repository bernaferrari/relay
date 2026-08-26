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
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { findWorkspaceRoot } from "./workspace-root.js";

const LEASE_DATABASE_NAME = "relay-server-lease.sqlite";
const LEASE_SCHEMA_VERSION = 1;
const LEASE_SLOT = "relay-server";

type PersistedRelayServerLease = {
  schemaVersion: typeof LEASE_SCHEMA_VERSION;
  leaseId: string;
  pid: number;
  host: string;
  acquiredAt: number;
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
  if (lease.schemaVersion !== LEASE_SCHEMA_VERSION) {
    throw new Error("Relay state server lease schema version is unsupported");
  }
  return {
    schemaVersion: LEASE_SCHEMA_VERSION,
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

function readLease(database: DatabaseSync): PersistedRelayServerLease | undefined {
  const row = database
    .prepare("SELECT document FROM relay_server_state_leases WHERE slot = ?")
    .get(LEASE_SLOT) as { document?: string } | undefined;
  return row?.document ? normalizeLease(JSON.parse(row.document) as unknown) : undefined;
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
    schemaVersion: LEASE_SCHEMA_VERSION,
    leaseId: randomUUID(),
    pid: positiveInteger(input.pid ?? process.pid, "pid"),
    host: nonEmpty(input.host ?? hostname(), "host"),
    acquiredAt: timestamp(input.acquiredAt ?? Date.now(), "acquiredAt"),
  };
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  let acquired = false;
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS relay_server_state_leases (
        slot TEXT PRIMARY KEY,
        document TEXT NOT NULL
      );
    `);
    const versionRow = database.prepare("PRAGMA user_version").get() as {
      user_version?: number;
    };
    const schemaVersion = Number(versionRow.user_version ?? 0);
    if (schemaVersion > LEASE_SCHEMA_VERSION) {
      throw new Error("Relay state server lease database is newer than this Relay build");
    }
    if (schemaVersion < LEASE_SCHEMA_VERSION) {
      database.exec(`PRAGMA user_version = ${LEASE_SCHEMA_VERSION}`);
    }
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
  localPortHasListener?: boolean;
};

type RelayStateServerLeaseRecoveryRefusalReason =
  | "owner-process-alive"
  | "lease-not-old-enough"
  | "local-port-listener-present"
  | "foreign-host-not-local-rename"
  | "state-not-workspace-local"
  | "no-existing-lease";

export type RelayStateServerLeaseRecovery =
  | {
      readonly status: "recovered";
      readonly reason: "local-hostname-collision-renamed" | "aged-dead-local-owner";
      readonly previousOwner: RelayStateServerLeaseOwner;
      readonly recoveredAt: number;
    }
  | {
      readonly status: "refused";
      readonly reason: RelayStateServerLeaseRecoveryRefusalReason;
      readonly owner?: Readonly<PersistedRelayServerLease>;
    };

function isLocalHostnameRenamed(previous: string, current: string): boolean {
  const base = (host: string): string => host.replace(/-?\d+\.local$/i, "").trim().toLowerCase();
  const previousBase = base(previous);
  return previousBase !== "" && previousBase === base(current);
}

/**
 * Reclaim a stale lease left behind by a dead local Relay server before this
 * one starts. Refuses live owners, young leases, and directories whose local
 * port already has a listener; a foreign host is only accepted when its name
 * looks like the local hostname renamed (macOS hostname collisions). The row
 * is removed inside one `BEGIN IMMEDIATE` transaction so a concurrent acquirer
 * never observes a partially reclaimed directory.
 */
export function recoverAbandonedLocalRelayStateServerLease(
  input: RecoverAbandonedLocalRelayStateServerLeaseInput = {},
): RelayStateServerLeaseRecovery {
  const path = input.path ?? relayStateServerLeasePath();
  const workspaceRoot = input.workspaceRoot ?? findWorkspaceRoot();
  const currentHost = nonEmpty(input.currentHost ?? hostname(), "currentHost");
  const now = timestamp(input.now ?? Date.now(), "now");
  const minimumAgeMs = timestamp(input.minimumAgeMs ?? 0, "minimumAgeMs");

  const stateRoot = join(workspaceRoot, ".relay");
  if (dirname(path) !== stateRoot || !path.endsWith(LEASE_DATABASE_NAME)) {
    return { status: "refused", reason: "state-not-workspace-local" };
  }

  mkdirSync(stateRoot, { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS relay_server_state_leases (
        slot TEXT PRIMARY KEY,
        document TEXT NOT NULL
      );
    `);
    begin(database);
    const existing = readLease(database);
    if (!existing) {
      rollback(database);
      return { status: "refused", reason: "no-existing-lease" };
    }
    const owner = existing;
    const refuse = (
      reason: RelayStateServerLeaseRecoveryRefusalReason,
    ): RelayStateServerLeaseRecovery => {
      rollback(database);
      return { status: "refused", reason, owner };
    };
    if (isProcessAlive(existing.pid)) return refuse("owner-process-alive");
    if (now - existing.acquiredAt < minimumAgeMs) return refuse("lease-not-old-enough");
    if (input.localPortHasListener === true) return refuse("local-port-listener-present");
    let recoveryReason: RelayStateServerLeaseRecovery["reason"];
    if (existing.host === currentHost) {
      recoveryReason = "aged-dead-local-owner";
    } else if (isLocalHostnameRenamed(existing.host, currentHost)) {
      recoveryReason = "local-hostname-collision-renamed";
    } else {
      return refuse("foreign-host-not-local-rename");
    }
    database.prepare("DELETE FROM relay_server_state_leases WHERE slot = ?").run(LEASE_SLOT);
    database.exec("COMMIT");
    return { status: "recovered", reason: recoveryReason, previousOwner: owner, recoveredAt: now };
  } catch (error) {
    rollback(database);
    throw error;
  } finally {
    closeDatabase(database);
  }
}
