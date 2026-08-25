/**
 * One XCTest runner per attached Apple device. Pointer and tree share it.
 */
import {
  resetDeviceClient,
  createDevice,
  snapshot,
  type Device,
} from "./device.js";
import {
  IOS_SNAPSHOT_SETTLE_WAIT_MS,
  isIosAccessibilityQueryInFlightError,
  waitForIosSnapshotFlightSettle,
} from "./ios-snapshot-flight.js";
import { getExecutingJobId, hardStopDeviceSession } from "./control.js";
import {
  IosDeviceAttentionError,
  IosRunnerSetupError,
  IosXCTestSessionUnavailableError,
  diagnoseIosRunnerError,
  prepareIosRunner,
} from "./ios-device-adapter.js";
import {
  createIosSessionRecoverySingleFlight,
  foreignSessionNameFromError,
  isIosDeviceLockedMidRun,
  recordRepairStep,
  recoverIosRuntime,
  recoverIosRuntimeSession,
  type IosRepairStepReporter,
  type IosRuntimeRecoveryResult,
  type IosRuntimeSessionRecovery,
} from "./ios-runtime-recovery.js";
import { androidSnapshotApplication, recoverAndroidInspection } from "./android-ui-snapshot.js";
import {
  killStaleIosTestRunners,
  remountIosDeveloperDiskImage,
} from "./ios-app-launch.js";
import { currentTargetContext, runWithTargetContext } from "./target-context.js";
import { runTargetMutation } from "./target-control.js";
import { resolveRuntimeTarget } from "./workspace-devices.js";
import {
  hasUsableSemanticAccessibility,
  recordTargetSemanticSnapshot,
  targetRuntimeReadiness,
} from "./target-runtime-readiness.js";
import type { IosSessionOperationLifecycle, TargetRuntimeReadiness } from "@relay/protocol";

/**
 * XCTest runner setup is a device concern, not a recording concern. Keep one
 * preparation in flight per device; otherwise an explicit Reconnect and a
 * deliberate evidence start could race to sign/install the same runner.
 */
const iosRunnerPreparations = new Map<string, Promise<void>>();
const iosRunnerFailures = new Map<string, { error: Error; expiresAt: number }>();
const iosRuntimeRecoveries = new Map<string, Promise<IosRuntimeRecoveryResult>>();
const runIosRecoverySingleFlight = createIosSessionRecoverySingleFlight<TargetRuntimeRecovery>();
const IOS_SESSION_UNAVAILABLE_FAILURE_TTL_MS = 10_000;
/**
 * A genuinely locked/passcode-bound iPad cannot be fixed by another screen
 * poll within seconds. Only concrete attention errors that are NOT a session
 * unavailability keep the long TTL.
 */
const IOS_DEVICE_ATTENTION_FAILURE_TTL_MS = 5 * 60_000;

/**
 * Key the shared-failure cache on the concrete class, not on the
 * `IosDeviceAttentionError` base: `IosXCTestSessionUnavailableError` extends
 * it, but a missing runner session is usually gone within seconds (the next
 * prepare attempt succeeds), while a locked device needs a human.
 */
function iosRunnerFailureTtlMs(error: Error): number {
  if (
    error instanceof IosXCTestSessionUnavailableError ||
    isIosAccessibilityQueryInFlightError(error)
  ) {
    return IOS_SESSION_UNAVAILABLE_FAILURE_TTL_MS;
  }
  return IOS_DEVICE_ATTENTION_FAILURE_TTL_MS;
}

/**
 * The only host-repair caller is `recoverTargetRuntime`. Keep preparation
 * behind this tiny seam so the one-attempt rule is regression-testable
 * without a connected iPad or an Xcode process.
 */
type IosSessionHostRuntime = {
  prepareIosRunner: typeof prepareIosRunner;
  recoverIosRuntime: typeof recoverIosRuntime;
};

const defaultIosSessionHostRuntime: IosSessionHostRuntime = {
  prepareIosRunner,
  recoverIosRuntime,
};
let iosSessionHostRuntime = defaultIosSessionHostRuntime;

/** Test-only seam. Production always uses the native Apple runtime. */
export function setIosSessionHostRuntimeForTests(
  overrides: Partial<IosSessionHostRuntime> | undefined,
): () => void {
  const previous = iosSessionHostRuntime;
  iosSessionHostRuntime = { ...defaultIosSessionHostRuntime, ...overrides };
  return () => {
    iosSessionHostRuntime = previous;
  };
}

export type IosSessionOperationDiagnostic = IosSessionOperationLifecycle;

const iosSessionOperationDiagnostics = new Map<string, IosSessionOperationDiagnostic>();

export function lastIosSessionOperationDiagnostic(
  serial: string,
): IosSessionOperationDiagnostic | undefined {
  const value = iosSessionOperationDiagnostics.get(serial);
  return value ? structuredClone(value) : undefined;
}

async function recoverIosHostRuntime(
  serial: string,
  cause: unknown,
  force = false,
): Promise<IosRuntimeRecoveryResult> {
  const existing = iosRuntimeRecoveries.get(serial);
  if (existing && !force) return existing;
  let recovery!: Promise<IosRuntimeRecoveryResult>;
  recovery = iosSessionHostRuntime.recoverIosRuntime({ serial, cause, force }).finally(() => {
    // A forced recovery can supersede an older poisoned attempt. Never let
    // that older promise delete the newer recovery when it eventually settles.
    if (iosRuntimeRecoveries.get(serial) === recovery) iosRuntimeRecoveries.delete(serial);
  });
  iosRuntimeRecoveries.set(serial, recovery);
  return recovery;
}

/** Forget runner preparation state after the Apple account or team changes. */
export function resetIosRunnerState(): void {
  iosRunnerPreparations.clear();
  iosRunnerFailures.clear();
  iosRuntimeRecoveries.clear();
}

type IosTargetRuntimeRecovery =
  | IosRuntimeSessionRecovery
  | (IosRuntimeRecoveryResult & {
      session: {
        status: "restored" | "unavailable";
        app?: string;
        fallback?: boolean;
        detail: string;
      };
    });

export type TargetRuntimeRecovery = IosTargetRuntimeRecovery & {
  /** Detailed capability planes supersede a platform-implied `ready` guess. */
  readiness?: TargetRuntimeReadiness;
};

/** Shared UI/CLI/MCP recovery for attached devices. */
export async function recoverTargetRuntime(
  serial: string,
  cause?: unknown,
  opts?: { force?: boolean },
): Promise<TargetRuntimeRecovery> {
  return runIosRecoverySingleFlight(serial, () =>
    runTargetMutation(serial, getExecutingJobId(), () =>
      recoverTargetRuntimeReserved(serial, cause, opts),
    ),
  );
}

async function recoverTargetRuntimeReserved(
  serial: string,
  cause?: unknown,
  opts?: { force?: boolean },
): Promise<TargetRuntimeRecovery> {
  const target = await resolveRuntimeTarget(serial);
  if (target.context.kind === "device" && target.context.platform === "android") {
    return runWithTargetContext(target.context, async () => {
      const inspection = await recoverAndroidInspection(serial);
      if (inspection.ready) return inspection;
      try {
        const nodes = await withSession(target.device, () =>
          snapshot(target.device, { interactiveOnly: false }),
        );
        if (nodes.length > 0) {
          const app = androidSnapshotApplication(nodes);
          return {
            serial,
            recovered: true,
            ready: true,
            summary: "Relay can read names on this screen.",
            actions: [
              {
                kind: "agent-device",
                status: "completed",
                detail: "Read names through the live Android helper session.",
              },
            ],
            session: {
              status: "restored" as const,
              ...(app ? { app } : {}),
              fallback: false,
              detail: "Relay can read names on this screen.",
            },
          };
        }
      } catch {
        // Helper artifact missing or session not bound; inspection already
        // tried the non-competing helper/dump path.
      }
      return inspection;
    });
  }
  if (target.context.kind !== "device" || target.context.platform !== "ios") {
    throw new Error("Automatic runtime recovery is currently available for connected devices only");
  }
  return runWithTargetContext(target.context, async () => {
    let device = target.device;
    const foreign = foreignSessionNameFromError(cause);
    let killed: string[] = [];
    let remounted = false;

    const withReadiness = (recovery: IosTargetRuntimeRecovery): TargetRuntimeRecovery => ({
      ...recovery,
      readiness: targetRuntimeReadiness({ serial, platform: "ios" }),
    });

    const inspect = async () => {
      const startedAt = Date.now();
      let nodes: Awaited<ReturnType<typeof snapshot>> = [];
      let recorded = false;
      try {
        // Probe the existing session before any setup, launch, stop, or host
        // repair. A reconnect request is not proof that the live runner is bad.
        nodes = await snapshot(device, { interactiveOnly: true });
        const semanticControl = hasUsableSemanticAccessibility(nodes);
        const capturedAt = Date.now();
        recordTargetSemanticSnapshot(
          { serial, platform: "ios" },
          {
            inspectable: semanticControl,
            nodes,
            at: capturedAt,
            durationMs: Math.max(0, capturedAt - startedAt),
            ...(semanticControl
              ? {}
              : { errorMessage: "Relay did not observe named accessibility controls." }),
          },
        );
        recorded = true;
        if (!semanticControl) {
          throw new IosXCTestSessionUnavailableError(
            "Reconnect prepared the XCTest runner, but it returned no named accessibility controls.",
          );
        }
        const currentApp = nodes.find((node) => node.bundleId)?.bundleId;
        return {
          ...(currentApp ? { app: currentApp } : {}),
          fallback: currentApp === "com.apple.springboard",
        };
      } catch (error) {
        // A bounded in-flight timeout is not a dead runner: the native
        // traversal may simply be slow. Re-probe once with an extended budget;
        // only if that also fails does repair get authorized — and even then
        // a still-in-flight flight must never trigger runner/testmanagerd
        // kills (see the repair gate below).
        if (isIosAccessibilityQueryInFlightError(error)) {
          try {
            nodes = await snapshot(device, {
              interactiveOnly: true,
              timeoutMs: IOS_SNAPSHOT_SETTLE_WAIT_MS * 2,
            });
            const settledControl = hasUsableSemanticAccessibility(nodes);
            const capturedAt = Date.now();
            recordTargetSemanticSnapshot(
              { serial, platform: "ios" },
              {
                inspectable: settledControl,
                nodes,
                at: capturedAt,
                durationMs: Math.max(0, capturedAt - startedAt),
                ...(settledControl
                  ? {}
                  : { errorMessage: "Relay did not observe named accessibility controls." }),
              },
            );
            recorded = true;
            if (!settledControl) {
              throw new IosXCTestSessionUnavailableError(
                "The extended accessibility probe completed, but returned no named controls.",
              );
            }
            const currentApp = nodes.find((node) => node.bundleId)?.bundleId;
            return {
              ...(currentApp ? { app: currentApp } : {}),
              fallback: currentApp === "com.apple.springboard",
            };
          } catch (settleError) {
            error = settleError;
          }
        }
        // A wedged session can actually be a locked screen: CoreDevice still
        // answers while every AX query returns nothing usable. Check the same
        // cheap passcode signal the runner setup path uses, with one
        // non-destructive settle-and-reprobe (Android wake-and-retry shape)
        // before demanding a person. This must surface as attention, not as
        // a generic unavailable session that invites destructive repair.
        if (!(error instanceof IosDeviceAttentionError)) {
          const locked = await isIosDeviceLockedMidRun(serial);
          if (locked) {
            throw new IosDeviceAttentionError(
              "This iPad is locked mid-session. Unlock it and keep it awake until the Automation Running indicator appears, then press Reconnect once.",
            );
          }
        }
        if (!recorded) {
          recordTargetSemanticSnapshot(
            { serial, platform: "ios" },
            {
              inspectable: false,
              nodes,
              at: Date.now(),
              durationMs: Math.max(0, Date.now() - startedAt),
              errorMessage:
                error instanceof IosXCTestSessionUnavailableError ||
                error instanceof IosDeviceAttentionError ||
                error instanceof IosRunnerSetupError
                  ? error.message
                  : undefined,
            },
          );
        }
        // Launch/pixel capture may remain available, but that is explicitly
        // not semantic control. Preserve the inspection failure so the
        // recovery result can be unavailable instead of falsely "ready".
        if (error instanceof IosXCTestSessionUnavailableError) throw error;
        throw new IosXCTestSessionUnavailableError(
          error instanceof Error
            ? error.message
            : "Reconnect could not prove an interactive iOS accessibility session.",
        );
      }
    };
    const repair = async (sessionError: unknown, onRepairStep: IosRepairStepReporter) => {
      // A still-running accessibility traversal proves the runner is alive.
      // Killing runners or testmanagerd under it would destroy the one healthy
      // session for a tree that merely reads slowly. Preserve it instead.
      if (isIosAccessibilityQueryInFlightError(sessionError)) {
        const settled = await waitForIosSnapshotFlightSettle(target.context);
        if (!settled) {
          return {
            serial,
            recovered: false,
            ready: false,
            actions: [],
            summary:
              "The accessibility tree is still being read; Relay preserved the live XCTest session instead of restarting it. Pixels remain usable while the query settles.",
          } satisfies IosRuntimeRecoveryResult;
        }
      }
      const named = foreignSessionNameFromError(sessionError) ?? foreign;
      // A watchdog/wedged cause describes a stuck runner process, not host
      // infrastructure. Route it to the targeted zombie-runner kill instead of
      // the generic agent-device daemon restart, which would tear down every
      // other attached device's session for one wedged XCTest runner.
      const repairCause = cause ?? sessionError;
      killed =
        (await recordRepairStep(onRepairStep, "kill-stale-runners", () =>
          killStaleIosTestRunners(serial),
        )) ?? [];
      iosRunnerPreparations.delete(serial);
      iosRunnerFailures.delete(serial);
      await recordRepairStep(onRepairStep, "hard-stop-session", async () => {
        await hardStopDeviceSession(target.context, named ? { alsoCloseSessions: [named] } : {});
      });
      resetDeviceClient(target.context);
      // Never force-restart CoreDevice here: that invalidates a freshly started
      // XCTest runner. Kill zombie runners, then prepare again.
      // A forced reconnect may clear a wedged owner.json lock that verified
      // stale-lock cleanup cannot touch; ordinary repair stays non-forced.
      const host = await recoverIosHostRuntime(serial, repairCause, opts?.force === true);
      device = createDevice();
      if (killed.length) {
        host.actions = [
          {
            kind: "agent-device",
            status: "completed",
            detail: `Stopped stale on-device test process${killed.length === 1 ? "" : "es"}: ${killed.join(", ")}.`,
          },
          ...host.actions,
        ];
        host.recovered = true;
      }
      try {
        await ensureIosRunnerPrepared(device, serial);
        onRepairStep({
          stage: "repair",
          outcome: "passed",
          durationMs: 0,
          detail: "Prepared the XCTest runner after cleanup.",
        });
        host.actions = [
          {
            kind: "agent-device",
            status: "completed",
            detail:
              "Prepared the XCTest runner; Relay is now verifying that it can read interactive accessibility nodes.",
          },
          ...host.actions,
        ];
        host.recovered = true;
      } catch {
        // AGENTS.md lore: remount DDI only if prepare fails. A wedged
        // developer disk image hangs XCTest launch; go-ios can unmount and
        // remount it without touching CoreDevice or rebooting the iPad.
        onRepairStep({
          stage: "repair",
          outcome: "failed",
          durationMs: 0,
          detail: "XCTest runner preparation failed after cleanup.",
        });
        const { ok: remounted, stderr } = await recordRepairStep(
          onRepairStep,
          "remount-developer-disk-image",
          () => remountIosDeveloperDiskImage(serial),
          "Remounted the developer disk image after runner preparation failed.",
        ).then((result) => result ?? { ok: false, stderr: "go-ios remount command failed" });

        if (remounted) {
          host.actions = [
            {
              kind: "agent-device",
              status: "completed",
              detail:
                "Remounted the iOS developer disk image after runner preparation failed (DDI was wedged; XCTest launch was hanging).",
            },
            ...host.actions,
          ];
          host.recovered = true;
          // Cached clients still point at the wedged DDI services. Drop them
          // so ensureIosRunnerPrepared talks to freshly mounted services.
          resetDeviceClient(target.context);
          device = createDevice();
          try {
            await ensureIosRunnerPrepared(device, serial);
            onRepairStep({
              stage: "repair",
              outcome: "passed",
              durationMs: 0,
              detail: "Prepared the XCTest runner after remounting the developer disk image.",
            });
            host.actions = [
              {
                kind: "agent-device",
                status: "completed",
                detail: "Prepared the XCTest runner after remounting the developer disk image.",
              },
              ...host.actions,
            ];
            host.recovered = true;
          } catch {
            onRepairStep({
              stage: "repair",
              outcome: "failed",
              durationMs: 0,
              detail: "XCTest runner preparation failed even after remounting the DDI.",
            });
          }
        } else {
          host.actions = [
            {
              kind: "agent-device",
              status: "failed",
              detail: `Could not remount the iOS developer disk image via go-ios after runner preparation failed${stderr ? `: ${stderr}` : "."}`,
            },
            ...host.actions,
          ];
        }
        // Screenshot + launch may still work; inspect will report the runner error.
      }
      return host;
    };

    // Always probe first. Even a prior binding error may describe a request
    // that lost a race while the shared session recovered independently.
    return withReadiness(
      await recoverIosRuntimeSession(
        serial,
        inspect,
        repair,
        async (error) => (await diagnoseIosRunnerError(error, serial)).message,
      ),
    );
  });
}

export function ensureIosRunnerPrepared(device: Device, serial: string): Promise<void> {
  const recentFailure = iosRunnerFailures.get(serial);
  if (recentFailure && recentFailure.expiresAt > Date.now()) {
    return Promise.reject(recentFailure.error);
  }
  if (recentFailure) iosRunnerFailures.delete(serial);

  const existing = iosRunnerPreparations.get(serial);
  if (existing) return existing;

  let preparation!: Promise<void>;
  // Preparation is a single proof attempt. It may install/start XCTest, but
  // it must never repair the host or retry itself: only an explicit Reconnect
  // may own destructive recovery and its mandatory post-repair proof.
  preparation = iosSessionHostRuntime
    .prepareIosRunner(device, { udid: serial })
    .then(() => {
      iosRunnerFailures.delete(serial);
    })
    .catch((error) => {
      if (iosRunnerPreparations.get(serial) === preparation) {
        iosRunnerPreparations.delete(serial);
      }
      // Setup and device-attention failures cannot be repaired by another
      // simultaneous screen poll. Briefly share the failure across screenshot,
      // snapshot, and video so the stage settles on one truthful state instead
      // of repeatedly launching xcodebuild while the person is unlocking or
      // approving UI Automation on the iPad.
      if (error instanceof IosRunnerSetupError || error instanceof IosDeviceAttentionError) {
        iosRunnerFailures.set(serial, {
          error,
          expiresAt: Date.now() + iosRunnerFailureTtlMs(error),
        });
      }
      throw error;
    });
  iosRunnerPreparations.set(serial, preparation);
  return preparation;
}

/**
 * Recover from session binding conflicts by releasing the stale binding
 * and retrying. Does NOT auto-open any app — each recipe opens its own.
 */
export async function withSession<T>(
  device: Device,
  op: () => Promise<T>,
  operation: IosSessionOperationDiagnostic["operation"] = "interaction",
): Promise<T> {
  // Observation and interaction are truthful operations, not hidden recovery
  // entry points. They get exactly one attempt and preserve the original
  // failure. Only recoverTargetRuntime may stop, prepare, launch, or retry.
  const startedAt = Date.now();
  try {
    const result = await op();
    const context = currentTargetContext();
    if (context.kind === "device" && context.platform === "ios") {
      iosSessionOperationDiagnostics.set(context.serial, {
        operation,
        outcome: "passed",
        code: "IOS_SESSION_OPERATION_READY",
        attempts: 1,
        repairAttempted: false,
        durationMs: Math.max(0, Date.now() - startedAt),
        stages: [
          {
            stage: "preview",
            outcome: operation === "preview" ? "passed" : "skipped",
          },
          { stage: "xctest-availability", outcome: "passed" },
          {
            stage: "accessibility-query",
            outcome: operation === "preview" || operation === "snapshot" ? "passed" : "skipped",
          },
          { stage: "repair", outcome: "skipped" },
        ],
      });
    }
    return result;
  } catch (error) {
    const context = currentTargetContext();
    if (context.kind === "device" && context.platform === "ios") {
      const queryInFlight = isIosAccessibilityQueryInFlightError(error);
      const diagnostic: IosSessionOperationDiagnostic = queryInFlight
        ? {
            operation,
            outcome: "in-flight",
            code: "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT",
            attempts: 1,
            repairAttempted: false,
            durationMs: Math.max(0, Date.now() - startedAt),
            stages: [
              {
                stage: "preview",
                outcome: operation === "preview" ? "in-flight" : "skipped",
              },
              // A timed-out traversal proves only that Relay stopped waiting.
              // It says nothing about runner setup or XCTest availability.
              { stage: "xctest-availability", outcome: "skipped" },
              { stage: "accessibility-query", outcome: "in-flight" },
              { stage: "repair", outcome: "skipped" },
            ],
          }
        : {
            operation,
            outcome: "unavailable",
            code: "IOS_SESSION_OPERATION_UNAVAILABLE",
            attempts: 1,
            repairAttempted: false,
            durationMs: Math.max(0, Date.now() - startedAt),
            stages: [
              {
                stage: "preview",
                outcome: operation === "preview" ? "failed" : "skipped",
              },
              // Mark a stage failed only when the error class proves it. Any
              // other failure stays "unknown"-truthful via skipped so a generic
              // app-binding error cannot masquerade as an Xcode problem.
              {
                stage: "xctest-availability",
                outcome:
                  error instanceof IosXCTestSessionUnavailableError ||
                  error instanceof IosRunnerSetupError
                    ? "failed"
                    : "skipped",
              },
              {
                stage: "accessibility-query",
                outcome: isIosAccessibilityQueryInFlightError(error) ? "in-flight" : "skipped",
              },
              { stage: "repair", outcome: "skipped" },
            ],
          };
      iosSessionOperationDiagnostics.set(context.serial, diagnostic);
      if (error instanceof Error) {
        Object.defineProperty(error, "iosSessionLifecycle", {
          configurable: true,
          enumerable: true,
          value: structuredClone(diagnostic),
        });
      }
    }
    throw error;
  }
}
