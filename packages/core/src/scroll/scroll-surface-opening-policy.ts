import type { SnapshotPayload } from "../workspace/workspace-capture.js";

export type ScrollSurfaceOpeningAssessment = { kind: "stable" } | { kind: "unstable" };

/** Product-owned policy for surfaces whose first viewport can be a crossfade
 * or otherwise contradictory before scrolling begins. Registration is explicit:
 * generic capture never applies product marketing or plan vocabulary by default. */
export type ScrollSurfaceOpeningPolicy = {
  kind: string;
  matches(snapshot: SnapshotPayload): boolean;
  assessOpening(snapshot: SnapshotPayload): ScrollSurfaceOpeningAssessment;
  unstableMessage(snapshot: SnapshotPayload): string;
};

const openingPolicies = new Map<string, ScrollSurfaceOpeningPolicy>();

export function registerScrollSurfaceOpeningPolicy(policy: ScrollSurfaceOpeningPolicy): () => void {
  const kind = policy.kind.trim();
  if (!kind) throw new Error("Scroll surface opening policy kind must not be empty");
  if (openingPolicies.has(kind)) {
    throw new Error(`Scroll surface opening policy already registered: ${kind}`);
  }
  const registered = { ...policy, kind };
  openingPolicies.set(kind, registered);
  return () => {
    if (openingPolicies.get(kind) === registered) openingPolicies.delete(kind);
  };
}

export function scrollSurfaceOpeningPolicy(kind: string): ScrollSurfaceOpeningPolicy | undefined {
  return openingPolicies.get(kind);
}
