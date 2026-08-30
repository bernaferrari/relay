import { isBlankScreenshot, type ScreenshotPayload, type SnapshotPayload } from "@relay/core";
import type { AuthoringObservationProof } from "@relay/protocol";

export type SemanticProofStatus = AuthoringObservationProof["semantics"]["status"];
type PixelBracketStatus = NonNullable<AuthoringObservationProof["pixels"]["bracket"]>["status"];

export function semanticProofStatus(snapshot: SnapshotPayload): SemanticProofStatus {
  const semanticReadiness = snapshot.readiness?.semanticControl;
  if (snapshot.inspectable === false || snapshot.nodes.length === 0) return "unavailable";
  if (semanticReadiness?.freshness === "stale") return "stale";
  return semanticReadiness && semanticReadiness.state !== "proven" ? "unavailable" : "current";
}

/** Classify the closing raster around an Apple semantic observation without
 * allowing the accessibility result to certify its own visual bracket. */
export function pixelBracketStatus(input: {
  before: ScreenshotPayload;
  beforeFingerprint: string;
  after: ScreenshotPayload;
  afterBytes: Uint8Array;
  afterFingerprint: string;
}): PixelBracketStatus {
  if (isBlankScreenshot(input.afterBytes)) return "unavailable";
  const dimensionsChanged =
    input.before.width !== undefined &&
    input.before.height !== undefined &&
    input.after.width !== undefined &&
    input.after.height !== undefined &&
    (input.before.width !== input.after.width || input.before.height !== input.after.height);
  if (dimensionsChanged) return "changed";
  return input.beforeFingerprint === input.afterFingerprint ? "coherent" : "changed";
}
