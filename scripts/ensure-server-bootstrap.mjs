/**
 * Fail-closed process control and serialization for ensure-server.
 *
 * Process discovery happens once. Only those immutable identities may be
 * signalled, and every signal repeats the identity check immediately before
 * calling kill(2). A SQLite write transaction serializes the full bootstrap;
 * the OS drops the lock on crash, so there is no stale pid-file to guess at.
 */
import { execFileSync as nodeExecFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class EnsureServerBootstrapLockedError extends Error {
  code = "RELAY_SERVER_BOOTSTRAP_LOCKED";

  constructor(path, options) {
    super(`Another Relay server bootstrap owns ${path}`, options);
    this.name = "EnsureServerBootstrapLockedError";
  }
}

export function acquireEnsureServerBootstrapLock({
  path,
  openDatabase = (databasePath) => new DatabaseSync(databasePath, { timeout: 0 }),
}) {
  mkdirSync(dirname(path), { recursive: true });
  const database = openDatabase(path);
  let owned = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    owned = true;
    database.exec(`
      CREATE TABLE IF NOT EXISTS relay_server_bootstrap_owner (
        slot INTEGER PRIMARY KEY CHECK (slot = 1),
        pid INTEGER NOT NULL,
        acquired_at INTEGER NOT NULL
      );
      INSERT OR REPLACE INTO relay_server_bootstrap_owner(slot, pid, acquired_at)
      VALUES(1, ${process.pid}, ${Date.now()});
    `);
  } catch (error) {
    try {
      database.close();
    } catch {
      // Cleanup cannot turn an uncertain lock acquisition into permission.
    }
    throw new EnsureServerBootstrapLockedError(path, { cause: error });
  }

  let released = false;
  return Object.freeze({
    path,
    release() {
      if (released) return;
      released = true;
      try {
        if (owned) database.exec("ROLLBACK");
      } finally {
        database.close();
      }
    },
  });
}

export async function withEnsureServerBootstrapLock({
  path,
  operation,
  acquireLock = acquireEnsureServerBootstrapLock,
}) {
  const lock = acquireLock({ path });
  try {
    return await operation();
  } finally {
    lock.release();
  }
}

const PS_ROW =
  /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/u;

export function parseProcessRows(stdout) {
  return stdout.split("\n").flatMap((line) => {
    const match = PS_ROW.exec(line);
    if (!match) return [];
    return [
      { pid: Number(match[1]), ppid: Number(match[2]), startedAt: match[3], command: match[4] },
    ];
  });
}

export function readProcessRows({ execFileSync = nodeExecFileSync } = {}) {
  try {
    return parseProcessRows(
      execFileSync("/bin/ps", ["-ww", "-ax", "-o", "pid=,ppid=,lstart=,command="], {
        encoding: "utf8",
      }),
    );
  } catch {
    return [];
  }
}

function processCwd(pid, execFileSync) {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1);
  } catch {
    return undefined;
  }
}

export function observeProcess(pid, { execFileSync = nodeExecFileSync } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  try {
    const rows = parseProcessRows(
      execFileSync("/bin/ps", ["-ww", "-p", String(pid), "-o", "pid=,ppid=,lstart=,command="], {
        encoding: "utf8",
      }),
    );
    const row = rows.find((candidate) => candidate.pid === pid);
    const cwd = processCwd(pid, execFileSync);
    return row && cwd ? Object.freeze({ ...row, cwd: resolve(cwd) }) : undefined;
  } catch {
    return undefined;
  }
}

export function relayWatcherArguments({ tsx, port }) {
  return [
    tsx,
    "watch",
    "--clear-screen=false",
    "--include",
    "../core/src",
    "--include",
    "../protocol/src",
    "--exclude",
    "../core/src/**/*.test.*",
    "--exclude",
    "../protocol/src/**/*.test.*",
    "--exclude",
    "../core/src/**/fixtures/**",
    "--exclude",
    "../protocol/src/**/fixtures/**",
    "src/index.ts",
    "--port",
    String(port),
  ];
}

function legacyRelayWatcherArguments({ tsx, port }) {
  return [
    tsx,
    "watch",
    "--clear-screen=false",
    "--include",
    "../core/src",
    "--include",
    "../protocol/src",
    "src/index.ts",
    "--port",
    String(port),
  ];
}

export function isExactRelayWatcher(
  identity,
  { root, tsx, port, nodeExecutable = process.execPath },
) {
  if (!identity || resolve(identity.cwd) !== resolve(join(root, "packages/server"))) return false;
  const actual = identity.command.trim().split(/\s+/u);
  const expectedCommands = [
    relayWatcherArguments({ tsx, port }),
    legacyRelayWatcherArguments({ tsx, port }),
  ];
  return expectedCommands.some((expectedArgs) => {
    const expected = [nodeExecutable, ...expectedArgs];
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  });
}

/**
 * The health endpoint proves which process owns the port, but its JSON is not
 * process identity. Verify the observed command/cwd too so a reused PID (or a
 * local service that happens to return Relay-shaped JSON) is never signalled.
 */
export function isRelayServerProcess(identity, { root, port }) {
  if (!identity || resolve(identity.cwd) !== resolve(join(root, "packages/server"))) return false;
  const actual = identity.command.trim().split(/\s+/u);
  const portIndex = actual.indexOf("--port");
  return (
    actual.includes("src/index.ts") && portIndex >= 0 && actual[portIndex + 1] === String(port)
  );
}

export function isProcessAncestor(ancestorPid, childPid, rows) {
  const parents = new Map(rows.map((row) => [row.pid, row.ppid]));
  const visited = new Set();
  let cursor = childPid;
  while (Number.isSafeInteger(cursor) && cursor > 1 && !visited.has(cursor)) {
    if (cursor === ancestorPid) return true;
    visited.add(cursor);
    cursor = parents.get(cursor);
  }
  return false;
}

function frozenAuthorization(role, identity) {
  return Object.freeze({ role, identity: Object.freeze({ ...identity }) });
}

/** Capture the complete and immutable set of processes this invocation may signal. */
export function authorizeRelayShutdown({
  root,
  tsx,
  port,
  portProbe,
  relayHealth,
  leasePreparation,
  processRows = readProcessRows(),
  observe = (pid) => observeProcess(pid),
  nodeExecutable = process.execPath,
}) {
  if (!leasePreparation.allowed) return Object.freeze([]);
  const healthPid = Number(relayHealth?.pid);
  const hasVerifiedLiveRelay =
    leasePreparation.mode === "replace-known-local-relay" &&
    relayHealth?.ok === true &&
    relayHealth?.product === "relay" &&
    Number.isSafeInteger(healthPid) &&
    portProbe.known === true &&
    portProbe.pids.includes(String(healthPid));
  const authorized = [];

  if (hasVerifiedLiveRelay) {
    const relayIdentity = observe(healthPid);
    if (!isRelayServerProcess(relayIdentity, { root, port })) {
      throw new Error("The health-verified Relay process changed during preflight");
    }
    authorized.push(frozenAuthorization("relay-listener", relayIdentity));
  }

  for (const row of processRows) {
    if (row.pid === process.pid || !row.command.includes(tsx) || !row.command.includes("watch"))
      continue;
    const identity = observe(row.pid);
    if (!isExactRelayWatcher(identity, { root, tsx, port, nodeExecutable })) continue;
    if (hasVerifiedLiveRelay && !isProcessAncestor(row.pid, healthPid, processRows)) continue;
    authorized.push(frozenAuthorization("repo-watcher", identity));
  }

  return Object.freeze(authorized);
}

function sameIdentity(expected, current) {
  return (
    current !== undefined &&
    current.pid === expected.pid &&
    current.startedAt === expected.startedAt &&
    current.command === expected.command &&
    current.cwd === expected.cwd
  );
}

function newListenerPids(portProbe, authorization) {
  if (!portProbe.known) throw new Error("Cannot prove the Relay port listener set");
  const authorizedListeners = new Set(
    authorization
      .filter((entry) => entry.role === "relay-listener")
      .map((entry) => String(entry.identity.pid)),
  );
  return portProbe.pids.filter((pid) => !authorizedListeners.has(String(pid)));
}

function signalAuthorized(authorization, signal, { observe, kill }) {
  for (const entry of authorization) {
    const current = observe(entry.identity.pid);
    if (!sameIdentity(entry.identity, current)) continue;
    try {
      kill(entry.identity.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}

function liveAuthorized(authorization, observe) {
  return authorization.some((entry) => sameIdentity(entry.identity, observe(entry.identity.pid)));
}

/** Stop only preflight-authorized identities. New listeners fail the bootstrap. */
export async function freeAuthorizedRelayProcesses({
  authorization,
  readPortProbe,
  observe = (pid) => observeProcess(pid),
  kill = (pid, signal) => process.kill(pid, signal),
  delay = (duration) => new Promise((resolveDelay) => setTimeout(resolveDelay, duration)),
  now = () => Date.now(),
  gracefulTimeoutMs = 3_000,
}) {
  const initialIntruders = newListenerPids(readPortProbe(), authorization);
  if (initialIntruders.length > 0) {
    throw new Error(
      `Relay port changed after preflight; refusing to signal pid ${initialIntruders.join(", ")}`,
    );
  }

  signalAuthorized(
    [...authorization].sort((left, right) =>
      left.role === "repo-watcher" ? -1 : right.role === "repo-watcher" ? 1 : 0,
    ),
    "SIGTERM",
    { observe, kill },
  );
  const deadline = now() + gracefulTimeoutMs;
  while (now() < deadline) {
    const intruders = newListenerPids(readPortProbe(), authorization);
    if (intruders.length > 0) {
      throw new Error(
        `A new Relay port listener appeared; refusing to signal pid ${intruders.join(", ")}`,
      );
    }
    if (!liveAuthorized(authorization, observe) && readPortProbe().pids.length === 0) return;
    await delay(150);
  }

  signalAuthorized(authorization, "SIGKILL", { observe, kill });
  await delay(200);
  const finalProbe = readPortProbe();
  const finalIntruders = newListenerPids(finalProbe, authorization);
  if (
    finalIntruders.length > 0 ||
    finalProbe.pids.length > 0 ||
    liveAuthorized(authorization, observe)
  ) {
    throw new Error(
      "Relay processes did not stop without crossing the preflight authorization boundary",
    );
  }
}
