/** Production mechanisms behind the TargetSupervisor recovery policy seam. */
import type { TargetRuntimeReadiness } from "@relay/protocol";
import { captureScreenshot, captureSnapshot, cleanupScreenshot } from "./workspace.js";
import { targetRuntimeReadiness } from "./target-runtime-readiness.js";
import {
  TargetSupervisorRecoveryCoordinator,
  type TargetSupervisorRecoveryAdapter,
  type TargetSupervisorRecoveryReceipt,
  type TargetSupervisorRecoveryResult,
} from "./target-supervisor-recovery-coordinator.js";
import type { SupervisedTarget, TargetSupervisorStore } from "./target-supervisor-store.js";
import { recoverTargetRuntime, type TargetRuntimeRecovery } from "./workspace-ios-session.js";

export type RecoveryMechanismResult = {
  readiness: TargetRuntimeReadiness;
  reason: string;
};

/**
 * The adapter deliberately has no input method. These are observation and
 * platform-repair mechanisms only; the supervisor owns ordering and bounded
 * escalation, while uncertain input remains fenced for explicit observation.
 */
export type LocalTargetSupervisorRecoveryMechanisms = {
  refreshPixels(target: SupervisedTarget): Promise<RecoveryMechanismResult>;
  refreshSemantics(target: SupervisedTarget): Promise<RecoveryMechanismResult>;
  restartSemanticRunner(target: SupervisedTarget): Promise<RecoveryMechanismResult>;
  preparePlatformServices(target: SupervisedTarget): Promise<RecoveryMechanismResult>;
};

function capabilityIsCurrent(
  readiness: TargetRuntimeReadiness,
  channel: "pixels" | "semantics",
): boolean {
  const capability = channel === "pixels" ? readiness.previewPixels : readiness.semanticControl;
  return capability.state === "proven" && capability.freshness === "current";
}

function receipt(
  channel: "pixels" | "semantics",
  result: RecoveryMechanismResult,
  durationMs: number,
): TargetSupervisorRecoveryReceipt {
  return {
    outcome: capabilityIsCurrent(result.readiness, channel) ? "succeeded" : "failed",
    durationMs,
    reason: result.reason,
    readiness: result.readiness,
  };
}

export function createLocalTargetSupervisorRecoveryAdapter(
  mechanisms: LocalTargetSupervisorRecoveryMechanisms,
): TargetSupervisorRecoveryAdapter {
  return {
    async execute(target, effect) {
      const startedAt = Date.now();
      let result: RecoveryMechanismResult;
      switch (effect.stage) {
        case "refresh-pixels":
          result = await mechanisms.refreshPixels(target);
          break;
        case "refresh-semantics":
          result = await mechanisms.refreshSemantics(target);
          break;
        case "restart-semantic-runner":
          result = await mechanisms.restartSemanticRunner(target);
          break;
        case "prepare-platform-services":
          result = await mechanisms.preparePlatformServices(target);
          break;
      }
      return receipt(effect.channel, result, Math.max(0, Date.now() - startedAt));
    },
  };
}

function runtimeReadiness(target: SupervisedTarget): TargetRuntimeReadiness {
  if (target.kind === "browser") {
    throw new Error("Local device recovery does not support browser targets");
  }
  return targetRuntimeReadiness({ serial: target.id, platform: target.kind });
}

function runtimeMechanisms(input: {
  cause?: unknown;
  force?: boolean;
}): LocalTargetSupervisorRecoveryMechanisms {
  const repair = async (
    target: SupervisedTarget,
    force: boolean,
  ): Promise<RecoveryMechanismResult> => {
    if (target.kind === "browser") {
      throw new Error("Local device recovery does not support browser targets");
    }
    const recovery = await recoverTargetRuntime(target.id, input.cause, { force });
    return { readiness: recovery.readiness ?? runtimeReadiness(target), reason: recovery.summary };
  };
  return {
    async refreshPixels(target) {
      if (target.kind === "browser") {
        throw new Error("Local device recovery does not support browser targets");
      }
      const screenshot = await captureScreenshot({
        serial: target.id,
        ephemeral: true,
        includeScreenMatch: false,
      });
      await cleanupScreenshot(screenshot.path).catch(() => undefined);
      return {
        readiness: runtimeReadiness(target),
        reason: "Relay captured fresh pixels without issuing input.",
      };
    },
    async refreshSemantics(target) {
      if (target.kind === "browser") {
        throw new Error("Local device recovery does not support browser targets");
      }
      const snapshot = await captureSnapshot({
        serial: target.id,
        interactiveOnly: false,
        includeVisual: false,
      });
      return {
        readiness: runtimeReadiness(target),
        reason: snapshot.inspectable
          ? "Relay captured fresh semantic controls without restarting the target."
          : "The bounded semantic refresh did not return inspectable controls.",
      };
    },
    restartSemanticRunner: (target) => repair(target, false),
    preparePlatformServices: (target) => repair(target, input.force === true),
  };
}

function recoverySummary(
  target: SupervisedTarget,
  channel: "pixels" | "semantics",
  result: TargetSupervisorRecoveryResult,
): TargetRuntimeRecovery {
  const capabilityReady = capabilityIsCurrent(result.health.readiness, channel);
  const ready =
    capabilityReady &&
    result.health.input.state === "ready" &&
    result.health.overall !== "needs-human" &&
    result.health.overall !== "quarantined";
  const lastAttempt = result.attempts.at(-1);
  const summary = ready
    ? channel === "pixels"
      ? "Relay restored fresh target pixels."
      : "Relay restored fresh semantic control."
    : (lastAttempt?.receipt.reason ?? "Bounded target recovery requires human review.");
  return {
    serial: target.id,
    recovered: result.attempts.some(({ receipt: attempt }) => attempt.outcome === "succeeded"),
    ready,
    summary,
    actions: result.attempts.map(({ effect, receipt: attempt }) => ({
      kind: "agent-device" as const,
      status: attempt.outcome === "succeeded" ? ("completed" as const) : ("failed" as const),
      detail: `${effect.stage}: ${attempt.reason ?? attempt.outcome}`,
    })),
    session: {
      status: ready ? "restored" : "unavailable",
      ...(result.health.context.foregroundApp ? { app: result.health.context.foregroundApp } : {}),
      fallback: channel === "pixels" && ready,
      detail: summary,
    },
    readiness: result.health.readiness,
  };
}

/**
 * Run one local target recovery under the durable supervisor. The caller
 * chooses the capability it needs; only the supervisor may escalate stages.
 */
export async function recoverSupervisedTargetRuntime(input: {
  store: TargetSupervisorStore;
  target: SupervisedTarget;
  channel: "pixels" | "semantics";
  cause?: unknown;
  force?: boolean;
  mechanisms?: LocalTargetSupervisorRecoveryMechanisms;
}): Promise<TargetRuntimeRecovery> {
  const adapter = createLocalTargetSupervisorRecoveryAdapter(
    input.mechanisms ?? runtimeMechanisms({ cause: input.cause, force: input.force }),
  );
  const coordinator = new TargetSupervisorRecoveryCoordinator(input.store, adapter);
  const result = await coordinator.recoverDetailed(input.target, input.channel);
  return recoverySummary(input.target, input.channel, result);
}
