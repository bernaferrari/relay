import type { TargetSupervisorHealth } from "@relay/protocol";
import {
  completeReconcileReceipt,
  controlTargetIdForBrowserLane,
  currentOperationContext,
  rememberReconcileReceipt,
} from "@relay/core";
import { HttpError } from "./http.js";
import { durableObservationId } from "./target-runtime-support.js";
import type { TargetRuntimeRouteRuntime } from "./target-runtime-routes.js";
import { recordAudit, type RequestContext } from "./security.js";

/** A deliberate review can acknowledge a legacy client pause, but cannot
 * replace any durable target fence or manufacture a native dispatch receipt. */
export function assertClientUnknownReviewAllowed(input: {
  mutationId: string;
  platform: "android" | "ios" | "browser";
  health: TargetSupervisorHealth;
  reconcilePending?: boolean;
}): void {
  if (input.platform !== "android" || !input.mutationId.startsWith("recording-mutation-")) {
    throw new HttpError(409, "Client-only review requires the exact legacy Android input", {
      code: "TARGET_CLIENT_INPUT_REVIEW_UNSUPPORTED",
    });
  }
  const health = input.health;
  if (
    input.reconcilePending ||
    health.input.state !== "ready" ||
    health.input.pendingMutationId ||
    health.control.state === "held-by-other" ||
    ["recovering", "needs-human", "quarantined"].includes(health.overall)
  ) {
    throw new HttpError(
      409,
      "Resolve the target's current input or recovery fence before reviewing this client-only input",
      {
        code: "TARGET_CLIENT_INPUT_REVIEW_BLOCKED",
      },
    );
  }
}

export async function completeClientUnknownInputReview(input: {
  scope: RequestContext;
  serial: string;
  mutationId: string;
  resolutionId?: string;
  outcome: "applied" | "not-applied" | "ambiguous";
  target: { id: string; platform: "android" | "ios" | "browser" };
  runtime: TargetRuntimeRouteRuntime;
}) {
  const { runtime, scope, target, serial, mutationId } = input;
  const observation = await runtime.captureTargetObservation(serial);
  // Observation may yield to another run or lease acquisition. Recheck
  // authority and target fences before durably acknowledging this ID.
  await runtime.assertTargetControl(scope, controlTargetIdForBrowserLane(serial));
  const health = runtime.readTargetHealth(target.id, target.platform);
  assertClientUnknownReviewAllowed({ mutationId, platform: target.platform, health });
  const review = {
    source: "operator-review" as const,
    observed:
      input.outcome === "applied"
        ? ("applied" as const)
        : input.outcome === "not-applied"
          ? ("not-observed" as const)
          : ("uncertain" as const),
    actorId: currentOperationContext()?.actorId ?? scope.subject,
  };
  const receiptScope = { organizationId: scope.organizationId, projectId: scope.projectId };
  const prepared = rememberReconcileReceipt({
    ...receiptScope,
    serial,
    mutationId,
    ...(input.resolutionId ? { resolutionId: input.resolutionId } : {}),
    outcome: input.outcome === "ambiguous" ? "ambiguous" : "acknowledged",
    review,
    observationId: durableObservationId(observation),
    observation,
  });
  const receipt = completeReconcileReceipt({
    ...receiptScope,
    receipt: prepared,
    health: health.input,
    healthSnapshot: { ...health, visibility: "project" },
  });
  recordAudit(scope, {
    action: "target.input.reconcile",
    resource: mutationId,
    target: serial,
    result: input.outcome === "ambiguous" ? "deny" : "allow",
  });
  return receipt;
}
