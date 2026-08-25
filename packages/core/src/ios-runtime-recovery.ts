import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { restartAgentDeviceDaemonForSetup } from "./device-setup.js";
import { captureIosPngViaGoIos, pixelEvidenceFingerprint } from "./ios-app-launch.js";
import {
  IosMutationOutcomeUnknownError,
  runIosMutationOnce,
  type IosMutationOperation,
} from "./ios-mutation-policy.js";

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

export type IosSessionLifecycleStage =
  | "preview"
  | "xctest-availability"
  | "accessibility-query"
  | "repair"
  | "post-repair-proof";

export type IosSessionLifecycleStep = {
  stage: IosSessionLifecycleStage;
  outcome: "passed" | "failed" | "skipped" | "attempted";
  durationMs: number;
  detail: string;
};

/**
 * Stable, host-neutral account of one bounded iOS control decision. UIs and
 * agents should consume this instead of inferring readiness from setup logs.
 */
export type IosSessionLifecycleDiagnostic = {
  operation: "recover";
  outcome: "ready" | "unavailable" | "proof-required";
  code: "IOS_SESSION_READY" | "IOS_SESSION_UNAVAILABLE" | "IOS_SESSION_PROOF_REQUIRED";
  probeAttempts: 1;
  repairAttempts: 0 | 1;
  proofAttempts: 0 | 1;
  repairAttempted: boolean;
  steps: IosSessionLifecycleStep[];
};

/**
 * One bounded cleanup action inside the destructive repair (runner kill, DDI
 * remount, hard stop). Recorded even when it fails so a swallowed catch can
 * no longer hide why the runner is still wedged.
 */
export type IosRepairStageStep = IosSessionLifecycleStep & { stage: "repair" };

/**
 * Callback the destructive-repair host uses to surface each bounded cleanup
 * step (runner kill, DDI remount, hard stop) as a lifecycle step instead of
 * letting individual failures disappear behind a bare catch.
 */
export type IosRepairStepReporter = (step: IosRepairStageStep) => void;

export type IosRuntimeSessionRecovery = IosRuntimeRecoveryResult & {
  session: {
    status: "restored" | "unavailable";
    app?: string;
    fallback?: boolean;
    detail: string;
  };
  lifecycle: IosSessionLifecycleDiagnostic;
};

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function probeSteps(outcome: "passed" | "failed", durationMs: number, detail: string) {
  return [
    { stage: "preview", outcome, durationMs, detail },
    {
      stage: "xctest-availability",
      outcome,
      durationMs,
      detail:
        outcome === "passed"
          ? "The existing XCTest session answered the bounded probe."
          : "The existing XCTest session did not answer the bounded probe.",
    },
    {
      stage: "accessibility-query",
      outcome,
      durationMs,
      detail:
        outcome === "passed"
          ? "The bounded accessibility query returned interactive nodes."
          : "Relay could not prove interactive accessibility from the bounded query.",
    },
  ] satisfies IosSessionLifecycleStep[];
}

/**
 * Run one bounded repair cleanup step, record its outcome as a lifecycle
 * step, and never let its failure abort the remaining cleanup. The returned
 * value is the step's own result (`undefined` on failure), so callers keep
 * their existing fallback behavior while the diagnostic keeps the error.
 */
export async function recordRepairStep<T>(
  reporter: IosRepairStepReporter | undefined,
  step: string,
  run: () => Promise<T>,
  passedDetail?: string,
): Promise<T | undefined> {
  const startedAt = Date.now();
  try {
    const value = await run();
    reporter?.({
      stage: "repair",
      outcome: "passed",
      durationMs: elapsed(startedAt),
      detail: passedDetail ?? "Repair cleanup step completed.",
    });
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reporter?.({
      stage: "repair",
      outcome: "failed",
      durationMs: elapsed(startedAt),
      detail,
    });
    return undefined;
  }
}

/** Share an entire recovery decision, including its destructive repair gate. */
export function createIosSessionRecoverySingleFlight<T = IosRuntimeSessionRecovery>() {
  const flights = new Map<string, Promise<T>>();
  return function singleFlight(serial: string, run: () => Promise<T>): Promise<T> {
    const existing = flights.get(serial);
    if (existing) return existing;
    let flight!: Promise<T>;
    flight = Promise.resolve()
      .then(run)
      .finally(() => {
        if (flights.get(serial) === flight) flights.delete(serial);
      });
    flights.set(serial, flight);
    return flight;
  };
}

/**
 * Preserve a working XCTest session. Recovery is a repair path, not a reset
 * button: restarting CoreDevice can turn an unattended, controllable iPad into
 * a locked device that cannot reconnect until a person returns.
 */
export async function recoverIosRuntimeSession(
  serial: string,
  inspect: () => Promise<{ app?: string; fallback?: boolean }>,
  repair: (
    cause: unknown,
    onRepairStep: IosRepairStepReporter,
  ) => Promise<IosRuntimeRecoveryResult>,
  diagnose: (error: unknown) => Promise<string>,
  /** Optional per-cleanup-step accounting inside the one bounded repair. */
  onRepairStep?: IosRepairStepReporter,
): Promise<IosRuntimeSessionRecovery> {
  const steps: IosSessionLifecycleStep[] = [];
  const onRepairStepOrDefault: IosRepairStepReporter = onRepairStep ?? ((step) => {
    steps.push(step);
  });
  const probeStartedAt = Date.now();
  try {
    const restored = await inspect();
    steps.push(...probeSteps("passed", elapsed(probeStartedAt), "Live session probe passed."));
    steps.push({
      stage: "repair",
      outcome: "skipped",
      durationMs: 0,
      detail: "No repair was needed; the existing session was preserved.",
    });
    steps.push({
      stage: "post-repair-proof",
      outcome: "skipped",
      durationMs: 0,
      detail: "No repair occurred, so no post-repair proof was required.",
    });
    return {
      serial,
      recovered: false,
      ready: true,
      actions: [],
      summary: "Relay device control is already ready.",
      session: {
        status: "restored",
        ...restored,
        detail: restored.fallback
          ? "Relay restored device control at the Home Screen."
          : "Relay restored the app that was active in this workspace.",
      },
      lifecycle: {
        operation: "recover",
        outcome: "ready",
        code: "IOS_SESSION_READY",
        probeAttempts: 1,
        repairAttempts: 0,
        proofAttempts: 0,
        repairAttempted: false,
        steps,
      },
    };
  } catch (cause) {
    steps.push(
      ...probeSteps(
        "failed",
        elapsed(probeStartedAt),
        cause instanceof Error ? cause.message : "Live session probe failed.",
      ),
    );
    const repairStartedAt = Date.now();
    let host: IosRuntimeRecoveryResult;
    try {
      host = await repair(cause, onRepairStepOrDefault);
      steps.push({
        stage: "repair",
        outcome: "attempted",
        durationMs: elapsed(repairStartedAt),
        detail: "Relay completed the single bounded repair attempt.",
      });
    } catch (repairError) {
      const detail = await diagnose(repairError);
      steps.push({
        stage: "repair",
        outcome: "failed",
        durationMs: elapsed(repairStartedAt),
        detail,
      });
      steps.push({
        stage: "post-repair-proof",
        outcome: "skipped",
        durationMs: 0,
        detail: "Repair failed, so Relay did not start another accessibility query.",
      });
      return {
        serial,
        recovered: false,
        ready: false,
        actions: [],
        summary: "The iPad automation session is unavailable. No further retries were started.",
        session: { status: "unavailable", detail },
        lifecycle: {
          operation: "recover",
          outcome: "unavailable",
          code: "IOS_SESSION_UNAVAILABLE",
          probeAttempts: 1,
          repairAttempts: 1,
          proofAttempts: 0,
          repairAttempted: true,
          steps,
        },
      };
    }
    return confirmIosRuntimeSession(host, inspect, diagnose, steps);
  }
}

/**
 * A bounded CoreDevice probe can time out while an already-installed XCTest
 * runner is usable. Confirm readiness with the operation Relay actually needs
 * before telling humans or agents that the device is unavailable.
 */
export async function confirmIosRuntimeSession(
  host: IosRuntimeRecoveryResult,
  restore: () => Promise<{ app?: string; fallback?: boolean }>,
  diagnose: (error: unknown) => Promise<string>,
  priorSteps: IosSessionLifecycleStep[] = [],
): Promise<IosRuntimeSessionRecovery> {
  const proofStartedAt = Date.now();
  try {
    const restored = await restore();
    const steps = [
      ...priorSteps,
      {
        stage: "post-repair-proof" as const,
        outcome: "passed" as const,
        durationMs: elapsed(proofStartedAt),
        detail: "The repaired session returned interactive accessibility nodes.",
      },
    ];
    return {
      ...host,
      ready: true,
      summary: host.ready
        ? host.summary
        : "Relay restored device control after Apple’s health check timed out.",
      session: {
        status: "restored",
        ...restored,
        detail: restored.fallback
          ? "Relay restored device control at the Home Screen."
          : "Relay restored the app that was active in this workspace.",
      },
      lifecycle: {
        operation: "recover",
        outcome: "ready",
        code: "IOS_SESSION_READY",
        probeAttempts: 1,
        repairAttempts: 1,
        proofAttempts: 1,
        repairAttempted: true,
        steps,
      },
    };
  } catch (error) {
    const detail = await diagnose(error);
    const steps = [
      ...priorSteps,
      {
        stage: "post-repair-proof" as const,
        outcome: "failed" as const,
        durationMs: elapsed(proofStartedAt),
        detail,
      },
    ];
    return {
      ...host,
      ready: false,
      session: {
        status: "unavailable",
        detail,
      },
      lifecycle: {
        operation: "recover",
        outcome: "proof-required",
        code: "IOS_SESSION_PROOF_REQUIRED",
        probeAttempts: 1,
        repairAttempts: 1,
        proofAttempts: 1,
        repairAttempted: true,
        steps,
      },
    };
  }
}

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
  return /timed out waiting for (?:the )?lock|lock owner|stale lock|coredevice\.actionerror|streamingaction|couldn['’]t get the message from the device|connection.*(?:closed|reset)|daemon.*(?:unavailable|disconnected|signature)|runner.*(?:exited|unavailable)|runner_busy|runner_wedged|still finishing a previous command|execution watchdog|main thread has been stuck|xcrun timed out|RUNNER_BUSY|RUNNER_WEDGED/i.test(
    errorText(error),
  );
}

export function isIosSessionBindingError(error: unknown): boolean {
  return /no active session|active app session|session[_ ]not[_ ]found|already in use by session|daemon request timed out/i.test(
    errorText(error),
  );
}

/** Extract a foreign agent-device session name from a binding conflict error. */
export function foreignSessionNameFromError(error: unknown): string | undefined {
  const match = errorText(error).match(/already in use by session ["']([^"']+)["']/i);
  const name = match?.[1]?.trim();
  return name || undefined;
}

/** Runner is alive but its main thread is stuck on abandoned XCTest work. */
export function isIosRunnerWatchdogError(error: unknown): boolean {
  return /still finishing a previous command|execution watchdog|main thread has been stuck|runner_busy|runner_wedged|RUNNER_BUSY|RUNNER_WEDGED/i.test(
    errorText(error),
  );
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
  // `info details` can succeed while the DDI process service used to install,
  // launch, and test apps is wedged. Probe the service Relay actually needs.
  return ["devicectl", "device", "info", "processes", "--device", serial, "--json-output", output];
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
  if (recovered) {
    return "Relay repaired its local Apple-device services, but iOS automation is still unavailable. Keep the iPad unlocked and cabled, open Xcode, and wait for Automation Running before one more Reconnect.";
  }
  return "The iPad automation service is unavailable. Keep the iPad unlocked and reconnect its cable.";
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
  // A watchdog/wedged cause means the runner process itself is stuck; the
  // targeted zombie-runner kill (host side) owns that repair. Restarting the
  // shared agent-device daemon for it would tear down every other attached
  // device's session, so watchdog causes never trigger the generic restart.
  const shouldRestartDaemon =
    input.force === true ||
    removedLock ||
    (!isIosRunnerWatchdogError(input.cause) && isRecoverableIosRuntimeError(input.cause));
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
  // A forced repair may restart CoreDevice after a failed bounded probe, but
  // never tears down a service that just proved healthy. This matters for
  // unattended physical devices: once their working runner is removed, a
  // locked screen can prevent developer services from reconnecting.
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

const IOS_LOCK_STATE_PROBE_TIMEOUT_MS = 10_000;

/**
 * Read the same cheap CoreDevice lock signal the runner setup path checks
 * (`devicectl device info lockState`). Returns `true` only when the device
 * explicitly reports a required passcode; every other outcome stays
 * `undefined` so a failed probe never fabricates an attention error.
 */
export async function probeIosDeviceLockState(
  serial: string,
  input: { run?: typeof run } = {},
): Promise<boolean | undefined> {
  const exec = input.run ?? run;
  const directory = await mkdtemp(join(tmpdir(), "relay-ios-lock-"));
  const output = join(directory, "lock-state.json");
  try {
    const result = await exec(
      "xcrun",
      [
        "devicectl",
        "device",
        "info",
        "lockState",
        "--device",
        serial,
        "--timeout",
        "8",
        "--json-output",
        output,
      ],
      IOS_LOCK_STATE_PROBE_TIMEOUT_MS,
    );
    if (result.exitCode !== 0) return undefined;
    const state = parseIosDeviceLockStateFile(await readFile(output, "utf8"));
    return state?.locked;
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseIosDeviceLockStateFile(value: string): { locked: boolean } | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result = parsed.result;
    if (!result || typeof result !== "object") return undefined;
    const passcodeRequired = (result as Record<string, unknown>).passcodeRequired;
    return typeof passcodeRequired === "boolean" ? { locked: passcodeRequired } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Mid-run lock detection mirrors Android's wake-and-retry shape: one
 * non-destructive settle-and-reprobe before demanding a person. Nothing here
 * sends physical input to a screen Relay cannot currently see.
 */
export async function isIosDeviceLockedMidRun(
  serial: string,
  input: { run?: typeof run } = {},
): Promise<boolean> {
  const first = await probeIosDeviceLockState(serial, input);
  if (first !== undefined) return first;
  // One non-destructive settle-and-reprobe before demanding a person.
  await new Promise<void>((resolveSettle) => {
    setTimeout(resolveSettle, 400);
  });
  const second = await probeIosDeviceLockState(serial, input);
  return second === true;
}

/**
 * Cheap pixel identity for the assisted second look. Capture failures stay
 * `undefined`: missing evidence must stop the re-dispatch, never fake a match.
 */
export async function captureIosPixelFingerprint(
  serial: string,
  input: { run?: (file: string, args: readonly string[], timeoutMs: number) => Promise<CommandResult> } = {},
): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "relay-ios-second-look-"));
  const path = join(directory, "frame.png");
  try {
    await captureIosPngViaGoIos(serial, path, input.run ? { run: input.run } : {});
    const bytes = await readFile(path);
    return pixelEvidenceFingerprint(bytes);
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type IosAssistedSecondLookDiagnostic = {
  operation: IosMutationOperation;
  baselineFingerprint?: string;
  currentFingerprint?: string;
  matchedBaseline: boolean;
  /** Exactly one evidence-backed re-dispatch is ever allowed. */
  redispatched: boolean;
};

function attachIosAssistedSecondLookDiagnostic(
  error: unknown,
  diagnostic: IosAssistedSecondLookDiagnostic,
): void {
  if (!error || typeof error !== "object") return;
  try {
    Object.defineProperty(error, "iosAssistedSecondLook", {
      configurable: true,
      enumerable: true,
      value: structuredClone(diagnostic),
    });
  } catch {
    // Frozen errors keep their original identity; the caller still sees it thrown.
  }
}

/**
 * Assisted second look after OutcomeUnknown (see ios-mutation-policy.ts):
 * compare a post-failure pixel fingerprint against the pre-dispatch baseline.
 * Only when the screen provably did not move may Relay issue exactly ONE
 * evidence-backed re-dispatch; otherwise this stops exactly as today.
 * Gated behind the explicit `assistedSecondLook` opt-in — the default
 * behavior is byte-for-byte the plain exact-once policy.
 */
export async function runIosMutationWithAssistedSecondLook<T>(
  serial: string,
  operation: IosMutationOperation,
  op: () => Promise<T>,
  input: {
    /** Explicit opt-in. Absent/false preserves today's intervention boundary. */
    assistedSecondLook?: boolean;
    /** Test-only seam; production captures real pixels via go-ios. */
    captureFingerprint?: () => Promise<string | undefined>;
  } = {},
): Promise<T> {
  const capture =
    input.captureFingerprint ?? (() => captureIosPixelFingerprint(serial));
  const baseline = await capture();
  try {
    return await runIosMutationOnce(serial, operation, op);
  } catch (error) {
    if (
      !(error instanceof IosMutationOutcomeUnknownError) ||
      input.assistedSecondLook !== true
    ) {
      throw error;
    }
    const current = await capture();
    const matchedBaseline = baseline !== undefined && baseline === current;
    const diagnostic: IosAssistedSecondLookDiagnostic = {
      operation,
      ...(baseline !== undefined ? { baselineFingerprint: baseline } : {}),
      ...(current !== undefined ? { currentFingerprint: current } : {}),
      matchedBaseline,
      redispatched: matchedBaseline,
    };
    if (!matchedBaseline) {
      attachIosAssistedSecondLookDiagnostic(error, diagnostic);
      throw error;
    }
    try {
      return await runIosMutationOnce(serial, operation, op);
    } catch (retryError) {
      attachIosAssistedSecondLookDiagnostic(retryError, diagnostic);
      throw retryError;
    }
  }
}
