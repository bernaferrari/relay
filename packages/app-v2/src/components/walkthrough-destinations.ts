import type { PlayerManifestProjection } from "../data/run-product-service";

/** Navigation may only promise a screenshot that exists in the selected configuration. */
export function walkthroughDestinationAvailable(
  manifest: PlayerManifestProjection,
  connection: PlayerManifestProjection["connections"][number],
  variantId: string | undefined,
): boolean {
  if (connection.kind === "suggested") return false;
  return manifest.captures.some(
    (capture) =>
      capture.stateId === connection.toStateId &&
      capture.variantId === variantId &&
      (connection.kind !== "recorded" ||
        !connection.provenance?.captureId ||
        capture.id === connection.provenance.captureId),
  );
}
