import { isPhysicalRunnerRoute, resolveAppleControlRoute } from "./apple-control-route.js";
import {
  cooperativeCheckpoint,
  JobCancelledError,
  JobControlOwnershipError,
  raceCancel,
} from "./control.js";
import { rememberedTargetApplication } from "./device.js";
import { resolveIosLaunchBundleId } from "./ios-app-launch.js";
import { postAdoptedIosRunnerCommand } from "./ios-runner-listener-command.js";
import { probeLiveIosRunnerListener, type LiveIosRunnerListener } from "./ios-runner-listener.js";
import { IosRunnerReadError } from "./ios-runner-read-error.js";
import { safeScreenReadCause } from "./recipe-screen-inspection.js";
import type { TestJob } from "./session-contract.js";
import { currentTargetContext } from "./target-context.js";

const FOREGROUND_WAIT_MS = 15_000;
const APPLICATION_STATES = new Set([
  "unknown",
  "notRunning",
  "runningBackground",
  "runningBackgroundSuspended",
  "runningForeground",
]);

function sameListener(a: LiveIosRunnerListener, b: LiveIosRunnerListener | null): boolean {
  return Boolean(
    b &&
    a.serial === b.serial &&
    a.runnerPid === b.runnerPid &&
    a.ownerPid === b.ownerPid &&
    a.port === b.port,
  );
}

/** This is a saved semantic Test prerequisite after a confirmed sidecar
 * relaunch, never part of public pixel-only app launch. `appState` constructs
 * the exact requested XCUIApplication without activation or tree traversal.
 * Foreground readiness does not prove a screen: the next strict AX read does. */
export async function awaitColdSavedIosAppForeground(
  job: TestJob,
  originApplication: string,
): Promise<void> {
  const context = job.targetContext;
  if (context.kind !== "device" || !isPhysicalRunnerRoute(resolveAppleControlRoute(context)))
    return;
  const bundleId = resolveIosLaunchBundleId(originApplication);
  const started = Date.now();
  const deadline = started + FOREGROUND_WAIT_MS;
  let reads = 0;
  let state: string | undefined;
  const fail = (reason: string, cause?: ReturnType<typeof safeScreenReadCause>): never => {
    job.artifacts.push({
      kind: "ios-app-launch-readiness",
      capturedAt: Date.now(),
      data: {
        schemaVersion: 1,
        appBundleId: bundleId,
        status: "unavailable",
        reason,
        reads,
        state,
        cause,
      },
    });
    throw new Error(
      `screen-inspection-unavailable: saved application foreground readiness unavailable (${reason}${cause ? `; cause ${cause.category}${cause.code ? `/${cause.code}` : ""}` : ""}); screen identity unproven`,
    );
  };
  const checkpoint = async () => {
    await cooperativeCheckpoint();
    const current = currentTargetContext();
    if (
      current.kind !== "device" ||
      current.platform !== "ios" ||
      current.serial !== context.serial ||
      (await rememberedTargetApplication(context)) !== bundleId
    )
      throw new JobControlOwnershipError("Saved iOS launch application ownership changed");
  };
  await checkpoint();
  const listener = await probeLiveIosRunnerListener(context.serial);
  if (!listener) return fail("runner-unavailable");
  while (true) {
    await checkpoint();
    if (!sameListener(listener, await probeLiveIosRunnerListener(context.serial)))
      fail("listener-changed");
    const remaining = deadline - Date.now();
    if (remaining < 2) fail("foreground-deadline", { category: "timeout" });
    // usbmux budgets connection and response separately. Their sum must fit
    // this one absolute foreground deadline; a failed request is terminal.
    const timeoutMs = Math.min(2_000, Math.floor(remaining / 2));
    reads += 1;
    let result;
    try {
      result = await raceCancel(
        postAdoptedIosRunnerCommand(
          listener,
          { command: "appState", appBundleId: bundleId, timeoutMs },
          timeoutMs,
        ),
      );
    } catch (error) {
      if (error instanceof JobCancelledError || error instanceof JobControlOwnershipError)
        throw error;
      await checkpoint();
      fail("read-failed", safeScreenReadCause(error));
    }
    await checkpoint();
    if (!sameListener(listener, await probeLiveIosRunnerListener(context.serial)))
      fail("listener-changed");
    if (Date.now() >= deadline) fail("foreground-deadline", { category: "timeout" });
    if (result?.ok !== true)
      return fail(
        "read-failed",
        safeScreenReadCause(new IosRunnerReadError(result ?? {}, "Native app state read failed")),
      );
    if (result.runnerMainThreadBusy === true)
      fail("read-failed", { category: "runner-busy", code: "RUNNER_BUSY" });
    const observedState = result.data?.applicationState;
    if (typeof observedState !== "string" || !APPLICATION_STATES.has(observedState))
      return fail("malformed-state");
    state = observedState;
    if (state === "runningForeground") {
      job.artifacts.push({
        kind: "ios-app-launch-readiness",
        capturedAt: Date.now(),
        data: {
          schemaVersion: 1,
          appBundleId: bundleId,
          status: "foreground",
          reads,
          elapsedMs: Date.now() - started,
        },
      });
      return;
    }
    await raceCancel(
      new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now()))),
    );
  }
}
