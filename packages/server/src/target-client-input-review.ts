import type { TargetSupervisorHealth } from "@relay/protocol";
import { HttpError } from "./http.js";

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
    throw new HttpError(409, "Resolve the target's current input or recovery fence before reviewing this client-only input", {
      code: "TARGET_CLIENT_INPUT_REVIEW_BLOCKED",
    });
  }
}
