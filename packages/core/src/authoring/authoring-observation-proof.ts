import type { AuthoringObservationProof } from "@relay/protocol";

/**
 * A current semantic tree can establish selectors and screen identity only
 * when its evidence says so. In particular, a tree bracketed by two iOS
 * rasters must have a coherent closing raster; treating a malformed or
 * partially persisted bracket as current would reintroduce the exact stale
 * AX promotion the bracket prevents.
 */
export function hasCurrentAuthoringSemantics(
  proof: AuthoringObservationProof | undefined,
): boolean {
  if (proof?.semantics.status !== "current") return false;
  return proof.captureOrder !== "pixels-ax-pixels" || proof.pixels.bracket?.status === "coherent";
}
