import type {
  AuthoringAction,
  AuthoringObservation,
  AuthoringTransitionProofStatus,
} from "@relay/protocol";

/**
 * Classify an action without conflating visual evidence with semantic control.
 * A screenshot at each endpoint is useful even while iOS XCTest is reading;
 * a current tree on each endpoint upgrades that record to semantic validation.
 */
export function authoringTransitionProofStatus(
  entrance: AuthoringObservation | undefined,
  exit: AuthoringObservation | undefined,
): AuthoringTransitionProofStatus {
  if (!entrance || !exit) return "unresolved";
  const pixelsCaptured =
    entrance.proof?.pixels.status === "captured" && exit.proof?.pixels.status === "captured";
  if (!pixelsCaptured) return "unresolved";
  const semanticsCurrent =
    entrance.proof?.semantics.status === "current" && exit.proof?.semantics.status === "current";
  return semanticsCurrent ? "verified" : "pixels-only";
}

/** A trim, reorder, or step replacement changes the path between otherwise
 * valid captures. Do not let pre-edit entrance/exit links imply that the new
 * sequence was physically verified; its replay must supply fresh proof. */
export function invalidateAuthoringActionProof(action: AuthoringAction): AuthoringAction {
  const {
    entranceObservationId: _entrance,
    exitObservationId: _exit,
    proofStatus: _status,
    ...rest
  } = action;
  return rest;
}
