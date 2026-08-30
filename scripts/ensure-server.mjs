#!/usr/bin/env node
/**
 * Start one fresh watched Relay HTTP server.
 *
 * The complete bootstrap is serialized through health readiness. Process
 * shutdown is limited to immutable identities authorized by preflight; stale
 * pid files and command substrings never grant signal permission.
 */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authorizeRelayShutdown,
  freeAuthorizedRelayProcesses,
  isProcessAncestor,
  readProcessRows,
  relayWatcherArguments,
  withEnsureServerBootstrapLock,
} from "./ensure-server-bootstrap.mjs";
import {
  prepareDefaultRelayStateDirectory,
  prepareLeaseForFreshServer,
} from "./ensure-server-lease-recovery.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.RELAY_PORT || 8787);
const healthUrl = `http://127.0.0.1:${port}/health`;
const stateDir = join(root, ".relay");
const pidFile = join(stateDir, "server.pid");
const logFile = join(stateDir, "server.log");
const lockFile = join(stateDir, "ensure-server-bootstrap.sqlite");
const reuse = process.argv.includes("--reuse");

async function readHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function portListeners() {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return {
      known: true,
      pids: [
        ...new Set(
          out
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ],
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 1 &&
      "stderr" in error &&
      String(error.stderr ?? "").trim() === ""
    ) {
      return { known: true, pids: [] };
    }
    return { known: false, pids: [] };
  }
}

function resolveTsx() {
  const candidates = [
    join(root, "node_modules/tsx/dist/cli.mjs"),
    join(root, "packages/server/node_modules/tsx/dist/cli.mjs"),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0];
}

async function waitForHealth(timeoutMs, predicate = () => true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readHealth();
    if (health?.ok && health.product === "relay" && predicate(health)) return health;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  return null;
}

function healthMatchesListener(health, probe) {
  return (
    health?.ok === true &&
    health.product === "relay" &&
    Number.isSafeInteger(Number(health.pid)) &&
    probe.known === true &&
    probe.pids.includes(String(health.pid))
  );
}

async function bootstrap() {
  const tsx = resolveTsx();
  const stateDirectoryPreparation = prepareDefaultRelayStateDirectory({
    configuredStateDirectory: process.env.RELAY_STATE_DIR,
  });
  if (!stateDirectoryPreparation.allowed) {
    const refusal = {
      status: "refused",
      stage: "relay-state-directory",
      reason: stateDirectoryPreparation.reason,
      port,
      message:
        "ensure:serve only manages the repository-local Relay state directory; refusing process control for a custom RELAY_STATE_DIR.",
    };
    throw Object.assign(new Error(refusal.message), { detail: refusal });
  }
  if (reuse) {
    const current = await readHealth();
    const probe = portListeners();
    if (healthMatchesListener(current, probe)) {
      return {
        status: "already-running",
        pid: current.pid,
        uptimeMs: current.uptimeMs ?? null,
        port,
      };
    }
  }

  const portProbe = portListeners();
  const currentHealth = await waitForHealth(2_000);
  const leasePreparation = prepareLeaseForFreshServer({
    root,
    tsx,
    portProbe,
    currentHost: hostname(),
    relayHealth: currentHealth,
  });
  if (!leasePreparation.allowed) {
    const refusal = {
      status: "refused",
      stage: "relay-state-lease-recovery",
      recovery: leasePreparation.recovery,
      port,
      message: "Refusing to start or stop processes because Relay ownership is uncertain.",
    };
    throw Object.assign(new Error(refusal.message), { detail: refusal });
  }
  if (leasePreparation.recovery.status === "recovered") {
    process.stderr.write(
      `${JSON.stringify({
        status: "recovered",
        stage: "relay-state-lease-recovery",
        recovery: leasePreparation.recovery,
      })}\n`,
    );
  }

  const authorization = authorizeRelayShutdown({
    root,
    tsx,
    port,
    portProbe,
    relayHealth: currentHealth,
    leasePreparation,
  });
  await freeAuthorizedRelayProcesses({ authorization, readPortProbe: portListeners });
  const emptyProbe = portListeners();
  if (!emptyProbe.known || emptyProbe.pids.length > 0) {
    throw new Error("Relay port changed before startup; refusing to spawn another server");
  }

  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, relayWatcherArguments({ tsx, port }), {
    cwd: join(root, "packages/server"),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  closeSync(logFd);
  if (!Number.isSafeInteger(child.pid))
    throw new Error("Relay watcher did not return a process id");
  writeFileSync(pidFile, `${child.pid}\n`);
  child.unref();

  const started = await waitForHealth(20_000, (health) => {
    const healthPid = Number(health.pid);
    return (
      Number.isSafeInteger(healthPid) &&
      healthMatchesListener(health, portListeners()) &&
      isProcessAncestor(child.pid, healthPid, readProcessRows())
    );
  });
  if (!started) {
    throw Object.assign(new Error("Relay server did not become healthy"), {
      detail: { status: "failed", port, logFile },
    });
  }
  return { status: "started", pid: started.pid, port, logFile };
}

mkdirSync(stateDir, { recursive: true });
try {
  const result = await withEnsureServerBootstrapLock({ path: lockFile, operation: bootstrap });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(
      error && typeof error === "object" && "detail" in error
        ? error.detail
        : {
            status: "refused",
            stage: "server-bootstrap",
            port,
            message: String(error?.message ?? error),
          },
    )}\n`,
  );
  process.exitCode = 1;
}
