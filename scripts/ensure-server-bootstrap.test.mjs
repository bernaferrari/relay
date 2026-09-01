import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireEnsureServerBootstrapLock,
  authorizeRelayShutdown,
  EnsureServerBootstrapLockedError,
  freeAuthorizedRelayProcesses,
  isExactRelayWatcher,
  isRelayServerProcess,
  relayWatcherArguments,
  withEnsureServerBootstrapLock,
} from "./ensure-server-bootstrap.mjs";

const root = "/workspace/relay";
const tsx = `${root}/node_modules/tsx/dist/cli.mjs`;
const port = 8787;
const nodeExecutable = "/runtime/node";
const watcherCommand = [nodeExecutable, ...relayWatcherArguments({ tsx, port })].join(" ");

function identity(
  pid,
  ppid,
  command,
  cwd = `${root}/packages/server`,
  startedAt = "Wed Aug 26 10:00:00 2026",
) {
  return { pid, ppid, command, cwd, startedAt };
}

test("bootstrap lock serializes the entire async operation and has no stale owner after release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-bootstrap-lock-"));
  const path = join(directory, "bootstrap.sqlite");
  let releaseOperation;
  try {
    const first = withEnsureServerBootstrapLock({
      path,
      operation: () =>
        new Promise((resolveOperation) => {
          releaseOperation = resolveOperation;
        }),
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.throws(
      () => acquireEnsureServerBootstrapLock({ path }),
      (error) => error instanceof EnsureServerBootstrapLockedError,
    );
    releaseOperation("healthy");
    assert.equal(await first, "healthy");
    const afterCrashSafeRelease = acquireEnsureServerBootstrapLock({ path });
    afterCrashSafeRelease.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("valid Relay authorization ignores stale pid-file values and loose unrelated watchers", async () => {
  const relay = identity(200, 100, `${nodeExecutable} src/index.ts --port ${port}`);
  const watcher = identity(100, 1, watcherCommand);
  const looseUnrelatedWatcher = identity(
    300,
    1,
    `${nodeExecutable} ${tsx} watch src/other.ts --port ${port}`,
    "/workspace/unrelated",
  );
  const stalePidFileProcess = identity(400, 1, `${nodeExecutable} unrelated-service`);
  const processes = new Map(
    [relay, watcher, looseUnrelatedWatcher, stalePidFileProcess].map((value) => [value.pid, value]),
  );
  const rows = [...processes.values()];
  const authorization = authorizeRelayShutdown({
    root,
    tsx,
    port,
    portProbe: { known: true, pids: ["200"] },
    relayHealth: { ok: true, product: "relay", pid: 200 },
    leasePreparation: { allowed: true, mode: "replace-known-local-relay" },
    processRows: rows,
    observe: (pid) => processes.get(pid),
    nodeExecutable,
  });
  assert.deepEqual(
    authorization.map((entry) => [entry.role, entry.identity.pid]),
    [
      ["relay-listener", 200],
      ["repo-watcher", 100],
    ],
  );

  const signals = [];
  await freeAuthorizedRelayProcesses({
    authorization,
    readPortProbe: () => ({ known: true, pids: processes.has(200) ? ["200"] : [] }),
    observe: (pid) => processes.get(pid),
    kill(pid, signal) {
      signals.push([pid, signal]);
      processes.delete(pid);
    },
  });
  assert.deepEqual(signals, [
    [100, "SIGTERM"],
    [200, "SIGTERM"],
  ]);
  assert.equal(processes.has(300), true);
  assert.equal(processes.has(400), true);
});

test("a reused health PID is rejected unless its command and workspace identity are Relay", () => {
  const reused = identity(
    200,
    1,
    `${nodeExecutable} unrelated-service --port ${port}`,
    "/workspace/other",
  );
  assert.equal(isRelayServerProcess(reused, { root, port }), false);
  assert.throws(
    () =>
      authorizeRelayShutdown({
        root,
        tsx,
        port,
        portProbe: { known: true, pids: ["200"] },
        relayHealth: { ok: true, product: "relay", pid: 200 },
        leasePreparation: { allowed: true, mode: "replace-known-local-relay" },
        observe: () => reused,
        nodeExecutable,
      }),
    /changed during preflight/u,
  );
});

test("genuine repo-local stray watchers require the exact command and cwd", () => {
  const exact = identity(100, 1, watcherCommand);
  assert.equal(isExactRelayWatcher(exact, { root, tsx, port, nodeExecutable }), true);
  assert.equal(
    isExactRelayWatcher(
      { ...exact, cwd: "/workspace/other/packages/server" },
      { root, tsx, port, nodeExecutable },
    ),
    false,
  );
  assert.equal(
    isExactRelayWatcher(
      { ...exact, command: `${watcherCommand} --extra` },
      { root, tsx, port, nodeExecutable },
    ),
    false,
  );

  const authorization = authorizeRelayShutdown({
    root,
    tsx,
    port,
    portProbe: { known: true, pids: [] },
    relayHealth: null,
    leasePreparation: { allowed: true, mode: "empty-state" },
    processRows: [exact],
    observe: () => exact,
    nodeExecutable,
  });
  assert.deepEqual(
    authorization.map((entry) => entry.identity.pid),
    [100],
  );
});

test("a listener that appears after preflight is never signalled", async () => {
  const relay = identity(200, 100, `${nodeExecutable} server-child`);
  const authorization = Object.freeze([
    Object.freeze({ role: "relay-listener", identity: Object.freeze(relay) }),
  ]);
  const signals = [];
  await assert.rejects(
    freeAuthorizedRelayProcesses({
      authorization,
      readPortProbe: () => ({ known: true, pids: ["999"] }),
      observe: () => relay,
      kill: (...args) => signals.push(args),
    }),
    /changed after preflight/u,
  );
  assert.deepEqual(signals, []);
});

test("identity is revalidated immediately before every signal", async () => {
  const expected = identity(200, 100, `${nodeExecutable} server-child`);
  const reused = {
    ...expected,
    startedAt: "Wed Aug 26 10:00:01 2026",
    command: `${nodeExecutable} unrelated`,
  };
  const authorization = Object.freeze([
    Object.freeze({ role: "relay-listener", identity: Object.freeze(expected) }),
  ]);
  const signals = [];
  await freeAuthorizedRelayProcesses({
    authorization,
    readPortProbe: () => ({ known: true, pids: [] }),
    observe: () => reused,
    kill: (...args) => signals.push(args),
  });
  assert.deepEqual(signals, []);
});
