import type { TargetRuntimeCapabilityReadiness } from "@relay/protocol";

/**
 * The live Stage paints pixels continuously, but accessibility is a bounded
 * XCTest observation. This pure projection keeps overlay and retry decisions
 * out of transport code so no caller can accidentally infer current controls
 * from an old tree.
 */
export type IosLiveSemanticPlane = {
  state: "current" | "stale" | "unproven" | "in-flight" | "unavailable" | "cooldown";
  /** Only current proof may decorate pixels or drive a semantic action. */
  overlaysEnabled: boolean;
  /** A bounded background/query attempt is permitted, never required. */
  permitsAutomaticProbe: boolean;
  proofAt?: number;
  nextProbeAt?: number;
};

export function iosLiveSemanticPlane(input: {
  readiness?: TargetRuntimeCapabilityReadiness;
  /** Set synchronously when Relay sends input or detects a material video change. */
  invalidatedAt?: number;
  now?: number;
}): IosLiveSemanticPlane {
  const readiness = input.readiness;
  const now = input.now ?? Date.now();
  const proofAt = readiness?.proof?.at;
  const invalidatedLocally =
    input.invalidatedAt !== undefined && (proofAt === undefined || proofAt < input.invalidatedAt);

  if (readiness?.state === "proven" && readiness.freshness === "current" && !invalidatedLocally) {
    return { state: "current", overlaysEnabled: true, permitsAutomaticProbe: true, proofAt };
  }
  if (readiness?.state === "proven" || readiness?.freshness === "stale" || invalidatedLocally) {
    return { state: "stale", overlaysEnabled: false, permitsAutomaticProbe: true, proofAt };
  }
  // Relay's bounded wait expired, but the native XCTest traversal is still
  // running. This must be separate from a failed runner: a second automatic
  // probe would compete with that traversal while the independent picture
  // stays useful.
  if (
    readiness?.state === "unavailable" &&
    (readiness.reason === "probe-in-flight" || readiness.lastError?.reason === "probe-in-flight")
  ) {
    return { state: "in-flight", overlaysEnabled: false, permitsAutomaticProbe: false };
  }
  if (readiness?.state === "unavailable" && readiness.nextProbeAt !== undefined) {
    return readiness.nextProbeAt > now
      ? {
          state: "cooldown",
          overlaysEnabled: false,
          permitsAutomaticProbe: false,
          nextProbeAt: readiness.nextProbeAt,
        }
      : {
          state: "unavailable",
          overlaysEnabled: false,
          permitsAutomaticProbe: false,
          nextProbeAt: readiness.nextProbeAt,
        };
  }
  if (readiness?.state === "unavailable") {
    return { state: "unavailable", overlaysEnabled: false, permitsAutomaticProbe: false };
  }
  return { state: "unproven", overlaysEnabled: false, permitsAutomaticProbe: true };
}

/** Short label for a low-priority glass hint. Avoid frame-rate or readiness
 * claims: proof time is the only honest semantic timestamp. */
export function iosSemanticPlaneCopy(
  plane: IosLiveSemanticPlane,
  now = Date.now(),
): {
  title: string;
  detail: string;
  retryAt?: number;
} {
  switch (plane.state) {
    case "current":
      return {
        title: "Labels current",
        detail: plane.proofAt
          ? `Proven ${Math.max(0, now - plane.proofAt)} ms ago.`
          : "Proven now.",
      };
    case "stale":
      return {
        title: "Labels refreshing",
        detail:
          "The picture is live. Relay hides old control bounds until it proves this screen again.",
      };
    case "in-flight":
      return {
        title: "Accessibility is still reading",
        detail: "The picture is live. Wait for the current names read to settle.",
      };
    case "cooldown":
      return {
        title: "Labels temporarily unavailable",
        detail: "The picture still works. Relay will not keep restarting XCTest while it recovers.",
        ...(plane.nextProbeAt !== undefined ? { retryAt: plane.nextProbeAt } : {}),
      };
    case "unavailable":
      return {
        title: "Labels unavailable",
        detail: "The picture still works. Reconnect once after Xcode shows Automation Running.",
        ...(plane.nextProbeAt !== undefined ? { retryAt: plane.nextProbeAt } : {}),
      };
    case "unproven":
      return {
        title: "Reading labels",
        detail: "The picture is live while Relay obtains one bounded accessibility proof.",
      };
  }
}
