import type {
  AuthoringAction,
  AuthoringObservation,
  AuthoringReplayActionOutcome,
  AuthoringReplayActionProof,
  AuthoringReplayActionTransition,
  AuthoringTakeRevision,
  ScreenIdentityObservation,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { authoringTransitionProofStatus } from "./authoring-transition-proof.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";

/** A Take must retain every observation an action links to. Keep that durable
 * index bounded rather than quietly dropping old endpoints or accepting an
 * unbounded recording. */
export const MAX_AUTHORING_RETAINED_OBSERVATIONS = 256;

function uniqueObservations(
  observations: readonly (AuthoringObservation | undefined)[],
): AuthoringObservation[] {
  const byId = new Map<string, AuthoringObservation>();
  for (const observation of observations) {
    if (!observation || byId.has(observation.id)) continue;
    byId.set(observation.id, structuredClone(observation));
  }
  return [...byId.values()];
}

/** Add immutable observations without ever evicting a linked endpoint. */
export function retainAuthoringObservations(
  existing: readonly AuthoringObservation[] | undefined,
  additions: readonly (AuthoringObservation | undefined)[],
): AuthoringObservation[] | undefined {
  const retained = uniqueObservations([...(existing ?? []), ...additions]);
  return retained.length <= MAX_AUTHORING_RETAINED_OBSERVATIONS ? retained : undefined;
}

/** Resolve action links for both new indexed revisions and legacy revisions
 * that retained only their explicit before/after observations. */
export function authoringRevisionObservations(
  revision: Pick<AuthoringTakeRevision, "observations" | "before" | "after">,
): AuthoringObservation[] {
  return uniqueObservations([...(revision.observations ?? []), revision.before, revision.after]);
}

function currentSemanticIdentity(
  observation: AuthoringObservation,
): ScreenIdentityObservation | undefined {
  if (observation.proof?.semantics.status !== "current") return undefined;
  if (observation.nodes?.length) {
    return observeScreenIdentity(observation.nodes as SnapshotNode[]);
  }
  const fingerprint = observation.proof.semantics.fingerprint;
  return fingerprint ? { fingerprint, nodes: [], volatileSignals: [] } : undefined;
}

/** A visual frame alone is intentionally insufficient to establish a new
 * navigation identity. It can still produce a `pixels-only` endpoint proof. */
export function authoringReplayTransition(
  entrance: AuthoringObservation | undefined,
  exit: AuthoringObservation | undefined,
): AuthoringReplayActionTransition {
  if (!entrance || !exit) return "unproven";
  const left = currentSemanticIdentity(entrance);
  const right = currentSemanticIdentity(exit);
  if (!left || !right) return "unproven";
  if (left.nodes.length > 0 && right.nodes.length > 0) {
    const comparison = compareScreenIdentity(left, right);
    if (comparison.decision === "match") return "unchanged";
    if (comparison.decision === "different") return "changed";
    return "unproven";
  }
  return left.fingerprint === right.fingerprint ? "unchanged" : "changed";
}

/** Construct one reviewable action result. Endpoint evidence is referenced by
 * id and retained on the owning replay attempt, never copied into each row. */
export function authoringReplayActionProof(input: {
  action: Pick<AuthoringAction, "id">;
  outcome: AuthoringReplayActionOutcome;
  entrance?: AuthoringObservation;
  exit?: AuthoringObservation;
  error?: string;
}): AuthoringReplayActionProof {
  const evidenceIds = [...(input.entrance?.evidenceIds ?? []), ...(input.exit?.evidenceIds ?? [])];
  return {
    actionId: input.action.id,
    outcome: input.outcome,
    proofStatus: authoringTransitionProofStatus(input.entrance, input.exit),
    transition: authoringReplayTransition(input.entrance, input.exit),
    ...(input.entrance ? { entranceObservationId: input.entrance.id } : {}),
    ...(input.exit ? { exitObservationId: input.exit.id } : {}),
    evidenceIds: [...new Set(evidenceIds)],
    ...(input.error ? { error: input.error } : {}),
  };
}
