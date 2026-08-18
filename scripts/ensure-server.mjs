#!/usr/bin/env node
/**
 * One Relay HTTP server. Always kill whatever is on the port and start a
 * fresh watched process, so "old server vs new server" cannot linger.
 * Also kills stray `tsx watch --port <RELAY_PORT>` leftovers that no longer
 * hold the listen socket. Pass --reuse to keep a healthy Relay already listening.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.RELAY_PORT || 8787);
const healthUrl = `http://127.0.0.1:${port}/health`;
const stateDir = join(root, ".relay");
const pidFile = join(stateDir, "server.pid");
const logFile = join(stateDir, "server.log");
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

function pidsOnPort() {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return [
      ...new Set(
        out
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

function pidFilePid() {
  try {
    const text = readFileSync(pidFile, "utf8").trim();
    return /^\d+$/u.test(text) ? [text] : [];
  } catch {
    return [];
  }
}

/** `tsx watch` leftovers can sit without holding the port after a crashed
 * reload. Killing only lsof listeners left agents fighting ghost watchers. */
function strayRelayWatchPids() {
  try {
    const out = execFileSync("/bin/ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
    return out.split("\n").flatMap((line) => {
      const trimmed = line.trim();
      const space = trimmed.indexOf(" ");
      if (space < 0) return [];
      const pid = trimmed.slice(0, space);
      if (pid === String(process.pid)) return [];
      const command = trimmed.slice(space + 1);
      if (!command.includes("tsx") || !command.includes("watch")) return [];
      if (!command.includes(`--port ${port}`) && !command.includes(`--port=${port}`)) {
        return [];
      }
      return [pid];
    });
  } catch {
    return [];
  }
}

function livingPids(pids) {
  return pids.filter((pid) => {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 1) return false;
    try {
      process.kill(n, 0);
      return true;
    } catch {
      return false;
    }
  });
}

function relayServerPids() {
  return livingPids([...new Set([...pidsOnPort(), ...pidFilePid(), ...strayRelayWatchPids()])]);
}

function stopPids(pids, signal) {
  for (const pid of pids) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 1) continue;
    try {
      process.kill(n, signal);
    } catch {
      // already gone
    }
  }
}

async function freePort() {
  stopPids(relayServerPids(), "SIGTERM");
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const left = relayServerPids();
    if (left.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  stopPids(relayServerPids(), "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
}

function resolveTsx() {
  const candidates = [
    join(root, "node_modules/tsx/dist/cli.mjs"),
    join(root, "packages/server/node_modules/tsx/dist/cli.mjs"),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0];
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readHealth();
    if (health?.ok && health.product === "relay") return health;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

if (reuse) {
  const current = await readHealth();
  if (current?.ok && current.product === "relay") {
    process.stdout.write(
      `${JSON.stringify({
        status: "already-running",
        pid: current.pid ?? null,
        uptimeMs: current.uptimeMs ?? null,
        port,
      })}\n`,
    );
    process.exit(0);
  }
}

await freePort();

mkdirSync(stateDir, { recursive: true });
const tsx = resolveTsx();
const logFd = openSync(logFile, "a");
const child = spawn(
  process.execPath,
  [
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
  ],
  {
    cwd: join(root, "packages/server"),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  },
);
writeFileSync(pidFile, `${child.pid}\n`);
child.unref();

const started = await waitForHealth(20_000);
if (!started) {
  process.stderr.write(`${JSON.stringify({ status: "failed", port, logFile })}\n`);
  process.exit(1);
}
process.stdout.write(
  `${JSON.stringify({
    status: "started",
    pid: started.pid ?? child.pid,
    port,
    logFile,
  })}\n`,
);
process.exit(0);
