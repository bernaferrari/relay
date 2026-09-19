/**
 * A live `xcodebuild test-without-building … testCommand` listener is the
 * XCTest session. Recover must adopt it, not kill it, and must not treat a
 * missing tree as “reboot the iPad”.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type LiveIosRunnerListener = {
  serial: string;
  runnerPid: number;
  port: number;
  /** Owning process from the lease; absent on pre-owner leases. */
  ownerPid?: number;
};

export function resolveIosRunnerLeasePath(
  serial: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir =
    env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR?.trim() ||
    join(homedir(), ".agent-device", "apple-runner", "leases");
  return join(dir, `${serial}.json`);
}

export function isIosRunnerProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readIosRunnerLease(
  serial: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LiveIosRunnerListener | null> {
  try {
    const raw = await readFile(resolveIosRunnerLeasePath(serial, env), "utf8");
    const doc = JSON.parse(raw) as { runnerPid?: unknown; port?: unknown; ownerPid?: unknown };
    const runnerPid = Number(doc.runnerPid);
    const port = Number(doc.port);
    const ownerPid = Number(doc.ownerPid);
    if (!Number.isInteger(runnerPid) || runnerPid <= 0) return null;
    if (!Number.isInteger(port) || port <= 0) return null;
    return {
      serial,
      runnerPid,
      port,
      ...(Number.isInteger(ownerPid) && ownerPid > 0 ? { ownerPid } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Proof a healthy `testCommand` listener is already up: lease + live
 * xcodebuild pid. Missing runner is not a reboot. Healthy runner is not a
 * recover-kill.
 */
export async function probeLiveIosRunnerListener(
  serial: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LiveIosRunnerListener | null> {
  const lease = await readIosRunnerLease(serial, env);
  if (!lease) return null;
  if (!isIosRunnerProcessAlive(lease.runnerPid)) return null;
  // A runner detached from a dead owner still holds that owner's XCTest app
  // context; its listener answers new sessions with empty trees. Only a live
  // owner's listener is a healthy attach target — a stale one must fall
  // through to the caller's own session so a fresh runner spawns.
  if (lease.ownerPid !== undefined && !isIosRunnerProcessAlive(lease.ownerPid)) {
    return null;
  }
  return lease;
}

export async function waitForIosRunnerListenerReady(
  serial: string,
  input: { timeoutMs?: number; pollMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<LiveIosRunnerListener | null> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const pollMs = input.pollMs ?? 400;
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const live = await probeLiveIosRunnerListener(serial, input.env);
    if (live) return live;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}
