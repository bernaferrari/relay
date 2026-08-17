import type { ScreenIdentity } from "./discovery-contract.js";

/** Ordered, reviewed ways to activate one navigation edge. Absolute viewport
 * coordinates are deliberately absent: the weakest allowed alternative is a
 * point inside a semantic element found in the current accessibility tree. */
export type ConnectionNavigationTarget =
  | { kind: "identifier"; identifier: string }
  | { kind: "accessibility"; label: string; role?: string }
  | {
      kind: "element-relative";
      anchor: { identifier?: string; label?: string; role?: string };
      xRatio: number;
      yRatio: number;
      reviewedAt: number;
      reviewedBy: string;
      evidenceIds: string[];
    };

export type ConnectionScreenProof = {
  screenId: string;
  identity: ScreenIdentity;
  evidenceIds: string[];
};

export type ConnectionNavigationContract = {
  /** Must be authored in identifier → accessibility → reviewed-anchor order. */
  targetAlternatives: ConnectionNavigationTarget[];
  /** Frozen destination identity reviewed with this edge, not a title guess. */
  expectedDestination: ConnectionScreenProof;
};

/** A reviewed inverse for one successful forward edge. Relay may only unwind
 * the edge with Back when this proof is present, and must verify the frozen
 * origin immediately after the mutation. Absence means "stop for repair", not
 * permission to guess with repeated Back or reopen the app. */
export type ConnectionReturnContract = {
  kind: "back";
  expectedDestination: ConnectionScreenProof;
  expectedApp?: string;
};

/** Surfaces where evidence must remain reviewable before Relay performs a
 * return mutation. Ordinary destinations use quiescence without a minimum
 * delay; the other kinds require a stable semantic+raster dwell. */
export type DestinationEvidenceSurface =
  | "ordinary"
  | "modal"
  | "preview"
  | "confirmation"
  | "dead-end";
