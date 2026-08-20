/**
 * One XCTest runner per attached Apple device. Pointer and tree share it.
 */
import {
  rememberedTargetApplication,
  resetDeviceClient,
  createDevice,
  snapshot,
  type Device,
} from "./device.js";
import { getExecutingJobId, hardStopDeviceSession } from "./control.js";
import {
  IosDeviceAttentionError,
  IosRunnerSetupError,
  IosXCTestSessionUnavailableError,
  diagnoseIosRunnerError,
  prepareIosRunner,
} from "./ios-device-adapter.js";
import {
  confirmIosRuntimeSession,
  isIosRunnerWatchdogError,
  isIosSessionBindingError,
  isRecoverableIosRuntimeError,
  foreignSessionNameFromError,
  recoverIosRuntime,
  recoverIosRuntimeSession,
  type IosRuntimeRecoveryResult,
  type IosRuntimeSessionRecovery,
} from "./ios-runtime-recovery.js";
import { androidSnapshotApplication, recoverAndroidInspection } from "./android-ui-snapshot.js";
import {
  killStaleIosTestRunners,
  launchIosAppOutsideXctest,
  remountIosDeveloperDiskImage,
} from "./ios-app-launch.js";
import { currentTargetContext, runWithTargetContext } from "./target-context.js";
import { runTargetMutation } from "./target-control.js";
import { resolveRuntimeTarget } from "./workspace-devices.js";

/**
 * XCTest runner setup is a device concern, not a recording concern. A stage
 * opens by reading the screen, so that first read must be able to prepare the
 * iOS runner too. Keep one preparation in flight per device; otherwise the
 * initial screenshot and UI-tree polls race each other and each attempt can
 * try to sign/install the same runner.
 */
const iosRunnerPreparations = new Map<string, Promise<void>>();
const iosRunnerFailures = new Map<string, { error: Error; expiresAt: number }>();
const iosRuntimeRecoveries = new Map<string, Promise<IosRuntimeRecoveryResult>>();
const IOS_RUNNER_FAILURE_TTL_MS = 10_000;
const IOS_DEVICE_ATTENTION_FAILURE_TTL_MS = 5 * 60_000;

async function restoreIosAppSession(
  device: Device,
  serial: string,
): Promise<{ app: string; fallback: boolean }> {
  const remembered = await rememberedTargetApplication({
    kind: "device",
    platform: "ios",
    serial,
  });
  const app = remembered ?? "com.apple.springboard";
  try {
    await launchIosAppOutsideXctest(serial, app, { relaunch: false });
  } catch {
    await device.apps.open({
      platform: "ios",
      udid: serial,
      app,
      relaunch: false,
      noRecord: true,
    });
  }
  return { app, fallback: !remembered };
}

async function recoverIosHostRuntime(
  serial: string,
  cause: unknown,
  force = false,
): Promise<IosRuntimeRecoveryResult> {
  const existing = iosRuntimeRecoveries.get(serial);
  if (existing && !force) return existing;
  let recovery!: Promise<IosRuntimeRecoveryResult>;
  recovery = recoverIosRuntime({ serial, cause, force }).finally(() => {
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

export type TargetRuntimeRecovery = IosRuntimeSessionRecovery;

/** Shared UI/CLI/MCP recovery for attached devices. */
export async function recoverTargetRuntime(
  serial: string,
  cause?: unknown,
): Promise<TargetRuntimeRecovery> {
  return runTargetMutation(serial, getExecutingJobId(), () =>
    recoverTargetRuntimeReserved(serial, cause),
  );
}

async function recoverTargetRuntimeReserved(
  serial: string,
  cause?: unknown,
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

    const inspect = async () => {
      await ensureIosRunnerPrepared(device, serial);
      try {
        const restored = await restoreIosAppSession(device, serial);
        // Preparing the runner only proves that Xcode accepted setup. It does
        // not prove the signed XCTest process can return accessibility nodes.
        // Reconnect is an explicit operation, so it must make that distinction
        // before declaring control ready. Keep this deliberately small: live
        // interaction needs hittable geometry, not a raw evidence traversal.
        const nodes = await withSession(device, () => snapshot(device, { interactiveOnly: true }));
        if (nodes.length === 0) {
          throw new IosXCTestSessionUnavailableError(
            "Reconnect prepared the XCTest runner, but it returned no interactive accessibility nodes.",
          );
        }
        return restored;
      } catch (error) {
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
    const repair = async (sessionError: unknown) => {
      const named = foreignSessionNameFromError(sessionError) ?? foreign;
      // Reconnect commonly runs while the current XCTest runner is perfectly
      // healthy. Killing it before the first minimal AX proof turns every
      // reconnect into a costly cold start. Only clean up after that proof
      // fails (or when an explicit foreign session/hard cause requested it).
      killed = await killStaleIosTestRunners(serial).catch(() => []);
      remounted = await remountIosDeveloperDiskImage(serial).catch(() => false);
      iosRunnerPreparations.delete(serial);
      iosRunnerFailures.delete(serial);
      await hardStopDeviceSession(
        target.context,
        named ? { alsoCloseSessions: [named] } : {},
      ).catch(() => undefined);
      resetDeviceClient(target.context);
      // Never force-restart CoreDevice here: that invalidates a freshly started
      // XCTest runner. Kill zombie runners, then prepare again.
      const host = await recoverIosHostRuntime(serial, cause ?? sessionError, false);
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
      if (remounted) {
        host.actions = [
          {
            kind: "agent-device",
            status: "completed",
            detail:
              "Remounted the iOS developer disk image (DDI was wedged; XCTest launch was hanging).",
          },
          ...host.actions,
        ];
        host.recovered = true;
      }
      try {
        await ensureIosRunnerPrepared(device, serial);
        host.actions = [
          {
            kind: "agent-device",
            status: "completed",
            detail:
              "Prepared the XCTest runner; Relay is now verifying that it can read interactive accessibility nodes.",
          },
          ...host.actions,
        ];
        host.ready = true;
        host.recovered = true;
      } catch {
        // Screenshot + launch may still work; inspect will report the runner error.
      }
      return host;
    };

    // Killing XCTest first makes a flaky runner unrecoverable. Inspect the live
    // session unless the caller already saw a conflict or hard failure.
    if (cause !== undefined || foreign) {
      const host = await repair(
        cause ?? new Error(foreign ? `already in use by session "${foreign}"` : "recover"),
      );
      return confirmIosRuntimeSession(
        host,
        inspect,
        async (error) => (await diagnoseIosRunnerError(error, serial)).message,
      );
    }
    return recoverIosRuntimeSession(
      serial,
      inspect,
      repair,
      async (error) => (await diagnoseIosRunnerError(error, serial)).message,
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
  preparation = prepareIosRunner(device, { udid: serial })
    .catch(async (error) => {
      if (!isRecoverableIosRuntimeError(error)) throw error;
      await recoverIosHostRuntime(serial, error);
      return prepareIosRunner(device, { udid: serial });
    })
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
          expiresAt:
            Date.now() +
            (error instanceof IosDeviceAttentionError
              ? IOS_DEVICE_ATTENTION_FAILURE_TTL_MS
              : IOS_RUNNER_FAILURE_TTL_MS),
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
export async function withSession<T>(device: Device, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const context = currentTargetContext();
    if (
      isIosSessionBindingError(err) &&
      context.kind === "device" &&
      context.platform === "ios" &&
      context.serial
    ) {
      await ensureIosRunnerPrepared(device, context.serial);
      await restoreIosAppSession(device, context.serial);
      return await op();
    }
    // Watchdog-wedged XCTest must kill the on-device runner, not just retry.
    if (
      isIosRunnerWatchdogError(err) &&
      context.kind === "device" &&
      context.platform === "ios" &&
      context.serial
    ) {
      await hardStopDeviceSession(context).catch(() => undefined);
      resetDeviceClient(context);
      iosRunnerPreparations.delete(context.serial);
      iosRunnerFailures.delete(context.serial);
      await recoverIosHostRuntime(context.serial, err, true);
      await ensureIosRunnerPrepared(device, context.serial);
      await restoreIosAppSession(device, context.serial);
      return await op();
    }
    if (
      isRecoverableIosRuntimeError(err) &&
      context.kind === "device" &&
      context.platform === "ios" &&
      context.serial
    ) {
      await hardStopDeviceSession(context).catch(() => undefined);
      resetDeviceClient(context);
      await recoverIosHostRuntime(context.serial, err);
      iosRunnerPreparations.delete(context.serial);
      iosRunnerFailures.delete(context.serial);
      await ensureIosRunnerPrepared(device, context.serial);
      await restoreIosAppSession(device, context.serial);
      return await op();
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/already bound/i.test(msg) && !getExecutingJobId()) {
      if (context.kind === "device" && context.platform === "ios") {
        throw err;
      }
      await hardStopDeviceSession(context).catch(() => undefined);
      return await op();
    }
    throw err;
  }
}
