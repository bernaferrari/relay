import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { restartAgentDeviceDaemonForSetup } from "./device-setup.js";

const execFileAsync = promisify(execFile);
const CORE_DEVICE_EXECUTABLE =
  "/Library/Developer/PrivateFrameworks/CoreDevice.framework/Versions/A/XPCServices/CoreDeviceService.xpc/Contents/MacOS/CoreDeviceService";

export type IosRuntimeRecoveryAction = {
  kind: "stale-lock" | "agent-device" | "core-device";
  status: "completed" | "skipped" | "failed";
  detail: string;
};

export type IosRuntimeRecoveryResult = {
  serial: string;
  recovered: boolean;
  ready: boolean;
  actions: IosRuntimeRecoveryAction[];
  summary: string;
};

type ProcessObservation = {
  alive: boolean;
  startTime?: string;
  command?: string;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type IosRuntimeRecoveryDependencies = {
  stateDir: string;
  readFile(path: string): Promise<string>;
  listDirectory(path: string): Promise<string[]>;
  removeDirectory(path: string): Promise<void>;
  process(pid: number): Promise<ProcessObservation>;
  run(command: string, args: string[], timeoutMs: number): Promise<CommandResult>;
  restartAgentDevice(): Promise<boolean>;
  terminate(pid: number): Promise<boolean>;
};

type LockOwner = {
  pid: number;
  startTime?: string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Only infrastructure failures are repaired automatically. Account, signing,
 * trust, Developer Mode, and application failures need a human decision and
 * must never be hidden behind a retry loop.
 */
export function isRecoverableIosRuntimeError(error: unknown): boolean {
  return /timed out waiting for (?:the )?lock|lock owner|stale lock|coredevice\.actionerror|streamingaction|couldn['’]t get the message from the device|connection.*(?:closed|reset)|daemon.*(?:unavailable|disconnected|signature)|runner.*(?:exited|unavailable)/i.test(
    errorText(error),
  );
}

export function isIosSessionBindingError(error: unknown): boolean {
  return /no active session|active app session|session[_ ]not[_ ]found/i.test(errorText(error));
}

function parseOwner(value: string): LockOwner | undefined {
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 1) {
      return undefined;
    }
    return {
      pid: record.pid,
      ...(typeof record.startTime === "string" && record.startTime.trim()
        ? { startTime: record.startTime.trim() }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function sameStartTime(left?: string, right?: string): boolean {
  if (!left || !right) return true;
  return left.replace(/\s+/g, " ").trim() === right.replace(/\s+/g, " ").trim();
}

function directChild(parent: string, candidate: string): boolean {
  const root = resolve(parent);
  const path = resolve(candidate);
  return path.startsWith(`${root}/`) && resolve(path, "..") === root;
}

async function lockCandidates(deps: IosRuntimeRecoveryDependencies): Promise<string[]> {
  const roots = [
    join(deps.stateDir, "apple-runner", "derived", "ios-device"),
    join(deps.stateDir, "apple-runner", "leases"),
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = await deps.listDirectory(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".lock")) continue;
      const path = join(root, basename(entry));
      if (directChild(root, path)) candidates.push(path);
    }
  }
  return candidates;
}

async function clearStaleLocks(
  deps: IosRuntimeRecoveryDependencies,
): Promise<IosRuntimeRecoveryAction[]> {
  const actions: IosRuntimeRecoveryAction[] = [];
  for (const path of await lockCandidates(deps)) {
    let owner: LockOwner | undefined;
    try {
      owner = parseOwner(await deps.readFile(join(path, "owner.json")));
    } catch {
      owner = undefined;
    }
    if (!owner) {
      actions.push({
        kind: "stale-lock",
        status: "skipped",
        detail: "Preserved a lock whose owner could not be verified.",
      });
      continue;
    }
    const process = await deps.process(owner.pid);
    if (process.alive && sameStartTime(owner.startTime, process.startTime)) continue;
    try {
      await deps.removeDirectory(path);
      actions.push({
        kind: "stale-lock",
        status: "completed",
        detail: "Removed a lock left by a process that is no longer running.",
      });
    } catch (error) {
      actions.push({
        kind: "stale-lock",
        status: "failed",
        detail: `Could not remove a verified stale lock: ${errorText(error)}`,
      });
    }
  }
  return actions;
}

function probeArgs(serial: string, output: string): string[] {
  return ["devicectl", "device", "info", "details", "--device", serial, "--json-output", output];
}

function probeHealthy(result: CommandResult): boolean {
  return result.exitCode === 0;
}

function coreDeviceFailure(result: CommandResult): boolean {
  return /coredevice\.actionerror|streamingaction|couldn['’]t get the message from the device/i.test(
    `${result.stdout}\n${result.stderr}`,
  );
}

async function coreDevicePids(deps: IosRuntimeRecoveryDependencies): Promise<number[]> {
  const result = await deps.run("ps", ["-axo", "pid=,command="], 5_000);
  if (result.exitCode !== 0) return [];
  return result.stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || match[2] !== CORE_DEVICE_EXECUTABLE) return [];
    const pid = Number(match[1]);
    return Number.isInteger(pid) && pid > 1 ? [pid] : [];
  });
}

async function restartCoreDevice(
  deps: IosRuntimeRecoveryDependencies,
): Promise<IosRuntimeRecoveryAction> {
  const pids = await coreDevicePids(deps);
  if (pids.length === 0) {
    return {
      kind: "core-device",
      status: "skipped",
      detail: "CoreDeviceService was not running; macOS will start it on demand.",
    };
  }
  const stopped = await Promise.all(pids.map((pid) => deps.terminate(pid)));
  return stopped.every(Boolean)
    ? {
        kind: "core-device",
        status: "completed",
        detail: "Restarted Apple device communication after its health check failed.",
      }
    : {
        kind: "core-device",
        status: "failed",
        detail: "Apple device communication could not be restarted safely.",
      };
}

function summary(ready: boolean, recovered: boolean): string {
  if (ready && recovered) return "Relay repaired the Apple device connection.";
  if (ready) return "The Apple device connection is healthy.";
  if (recovered) return "Relay repaired local runtime state, but the iPad is not ready yet.";
  return "The iPad still needs attention.";
}

/**
 * Repair only Relay-owned locks and exact, verified helper processes. The
 * routine is bounded: one cleanup, one daemon restart, at most one CoreDevice
 * restart, then one final health probe.
 */
export async function recoverIosRuntime(
  input: { serial: string; cause?: unknown; force?: boolean },
  dependencies: Partial<IosRuntimeRecoveryDependencies> = {},
): Promise<IosRuntimeRecoveryResult> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const actions = await clearStaleLocks(deps);
  const removedLock = actions.some(
    (action) => action.kind === "stale-lock" && action.status === "completed",
  );
  const shouldRestartDaemon =
    input.force === true || removedLock || isRecoverableIosRuntimeError(input.cause);
  if (shouldRestartDaemon) {
    const restarted = await deps.restartAgentDevice();
    actions.push({
      kind: "agent-device",
      status: restarted ? "completed" : "skipped",
      detail: restarted
        ? "Restarted Relay’s local device helper with clean runtime state."
        : "Relay’s local device helper was already stopped.",
    });
  }

  const output = join(
    tmpdir(),
    `relay-ios-health-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  let probe = await deps.run("xcrun", probeArgs(input.serial, output), 15_000);
  if (!probeHealthy(probe) && coreDeviceFailure(probe)) {
    actions.push(await restartCoreDevice(deps));
    probe = await deps.run("xcrun", probeArgs(input.serial, output), 15_000);
  }
  await rm(output, { force: true }).catch(() => undefined);
  const ready = probeHealthy(probe);
  const recovered = actions.some((action) => action.status === "completed");
  return {
    serial: input.serial,
    recovered,
    ready,
    actions,
    summary: summary(ready, recovered),
  };
}

function defaultDependencies(): IosRuntimeRecoveryDependencies {
  const stateDir = process.env.AGENT_DEVICE_STATE_DIR?.trim() || join(homedir(), ".agent-device");
  const observeProcess = async (pid: number): Promise<ProcessObservation> => {
    const result = await run("ps", ["-p", String(pid), "-o", "lstart=,command="], 5_000);
    if (result.exitCode !== 0 || !result.stdout.trim()) return { alive: false };
    const line = result.stdout.trim();
    const match = line.match(/^(.{24})\s+(.+)$/);
    return {
      alive: true,
      ...(match?.[1]?.trim() ? { startTime: match[1].trim() } : {}),
      ...(match?.[2]?.trim() ? { command: match[2].trim() } : {}),
    };
  };
  return {
    stateDir,
    readFile: (path) => readFile(path, "utf8"),
    listDirectory: (path) => readdir(path),
    removeDirectory: (path) => rm(path, { recursive: true, force: false }),
    process: observeProcess,
    run,
    restartAgentDevice: restartAgentDeviceDaemonForSetup,
    async terminate(pid) {
      const observation = await observeProcess(pid);
      if (!observation.alive || observation.command !== CORE_DEVICE_EXECUTABLE) return false;
      try {
        process.kill(pid, "SIGTERM");
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function run(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const value = error as Error & { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      exitCode: typeof value.code === "number" ? value.code : 1,
      stdout: typeof value.stdout === "string" ? value.stdout : "",
      stderr:
        typeof value.stderr === "string" && value.stderr.trim() ? value.stderr : errorText(error),
    };
  }
}
