import { isPhysicalRunnerRoute, resolveAppleControlRoute } from "./apple-control-route.js";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  JobCancelledError,
  JobControlOwnershipError,
} from "./control.js";
import type { Device } from "./device.js";
import { probeLiveIosRunnerListener } from "./ios-runner-listener.js";
import type { TargetContext } from "./target-context.js";
import { runTargetMutation, TargetControlReservedError } from "./target-control.js";
import { currentTargetSupervisorStore } from "./target-supervisor-store.js";
import { ensureIosRunnerPrepared } from "./workspace-ios-session.js";

type SavedTestIosRunnerRuntime = {
  probe: typeof probeLiveIosRunnerListener;
  prepare: typeof ensureIosRunnerPrepared;
  checkpoint: typeof cooperativeCheckpoint;
};

const defaultRuntime: SavedTestIosRunnerRuntime = {
  probe: probeLiveIosRunnerListener,
  prepare: ensureIosRunnerPrepared,
  checkpoint: cooperativeCheckpoint,
};

function unavailable(cause?: unknown): Error {
  return new Error(
    "Relay could not start device control for this iPad. Press Reconnect, then run the Test again.",
    cause === undefined ? undefined : { cause },
  );
}

/** Saved Tests need named controls before their first launch or screen check.
 * Adopt the live runner, or request one bounded preparation under job ownership.
 * Availability is not screen proof: the recipe still verifies its current app
 * and source screen. Observation and ordinary app launch never enter this path. */
export async function ensureSavedTestIosRunner(
  device: Device,
  context: TargetContext,
  log: (line: string) => void,
  runtime: SavedTestIosRunnerRuntime = defaultRuntime,
): Promise<void> {
  if (context.kind !== "device" || !isPhysicalRunnerRoute(resolveAppleControlRoute(context)))
    return;
  const serial = context.serial;
  const checkpoint = async () => {
    await runtime.checkpoint();
    const store = currentTargetSupervisorStore();
    if (!store) throw new Error("Saved iOS Test startup requires the durable TargetSupervisor");
    const health = store.health({ id: serial, kind: "ios" });
    if (
      health.input.state !== "ready" ||
      health.input.pendingMutationId ||
      health.overall === "needs-human" ||
      health.overall === "quarantined"
    ) {
      throw new Error(
        `Saved iOS Test startup is blocked pending observation and review. ${health.input.reason ?? "Target requires human review."}`,
      );
    }
  };
  const probe = async () => {
    const listener = await runtime.probe(serial);
    if (listener && listener.serial !== serial) {
      throw unavailable(new Error("XCTest listener belongs to another target"));
    }
    return listener;
  };
  await checkpoint();
  const live = await probe();
  await checkpoint();
  if (live) {
    log("startup: adopted live XCTest listener for saved Test");
    return;
  }
  await runTargetMutation(serial, getExecutingJobId(), async () => {
    await checkpoint();
    // Another owned preparation may have finished while this caller queued.
    if (await probe()) {
      await checkpoint();
      log("startup: adopted live XCTest listener for saved Test");
      return;
    }
    await checkpoint();
    log("startup: XCTest listener unavailable; requesting one bounded preparation");
    try {
      // Keep the target reservation until native preparation settles. Racing
      // cancellation would release it while this bounded startup still runs.
      await runtime.prepare(device, serial);
    } catch (error) {
      await checkpoint();
      if (
        error instanceof JobCancelledError ||
        error instanceof JobControlOwnershipError ||
        error instanceof TargetControlReservedError
      )
        throw error;
      log(
        `startup: XCTest runner preparation failed (${error instanceof Error ? error.message : String(error)})`,
      );
      throw unavailable(error);
    }
    await checkpoint();
    const prepared = await probe();
    await checkpoint();
    if (!prepared) throw unavailable();
    log("startup: prepared live XCTest listener for saved Test");
  });
}
