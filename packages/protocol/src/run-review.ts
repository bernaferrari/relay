import type { ActorKind } from "./coordination.js";

/**
 * A deliberately unresolved verification result. This is separate from a
 * failure: the runtime completed, but a capability or signal was not
 * available yet, so a person can make the final decision later without
 * re-running the whole flow.
 */
export type RunReview = {
  schemaVersion: 1;
  status: "pending" | "approved" | "rejected";
  capability: string;
  reason: string;
  requestedAt: number;
  requestedBy?: { id: string; kind: ActorKind };
  decidedAt?: number;
  decidedBy?: { id: string; kind: ActorKind };
  note?: string;
};
