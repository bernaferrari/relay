/**
 * Compile-time guard for the one high-distance Android restore capability.
 *
 * Compilation may see imported or hand-authored App Map JSON, so this keeps
 * the baseline provenance checks next to the scroll-surface domain rather
 * than letting recipe scheduling infer origin from normalized viewport zero.
 * Runtime repeats—and cryptographically verifies—the receipt before moving a
 * device.
 */
import type {
  LogicalScrollSurface,
  ScrollSurfaceEvidence,
  ScrollSurfaceViewport,
} from "@relay/protocol";

function frozenEvidenceIsComplete(
  evidence: ScrollSurfaceEvidence | undefined,
  mime: ScrollSurfaceEvidence["mime"],
): boolean {
  return Boolean(
    evidence &&
    typeof evidence.id === "string" &&
    evidence.id.trim() &&
    evidence.mime === mime &&
    Number.isSafeInteger(evidence.bytes) &&
    evidence.bytes >= 0 &&
    typeof evidence.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(evidence.sha256) &&
    evidence.uri === `relay-evidence://${evidence.sha256}`,
  );
}

/** Only a complete, independently attested zero-offset raw PNG/tree pair can
 * enter an executable recipe as a frozen document origin. Stale, imported,
 * malformed, or mid-page surfaces remain on exact inverse restoration. */
export function frozenDocumentOrigin(
  surface: LogicalScrollSurface,
): ScrollSurfaceViewport | undefined {
  const origin = surface.viewports[0];
  const proof = surface.documentOriginProof;
  if (
    !origin ||
    !proof ||
    proof.schemaVersion !== 1 ||
    proof.method !== "frozen-origin-match" ||
    !proof.authorization ||
    proof.authorization.schemaVersion !== 1 ||
    proof.authorization.issuer !== "relay-local-capture" ||
    typeof proof.authorization.signature !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(proof.authorization.signature) ||
    proof.firstViewport.screenshotSha256 !== origin.screenshot.sha256 ||
    proof.firstViewport.accessibilityTreeSha256 !== origin.accessibilityTree.sha256 ||
    origin.index !== 0 ||
    origin.offsetY !== 0 ||
    origin.appendedHeight !== 0 ||
    !Number.isSafeInteger(origin.capturedAt) ||
    !Number.isSafeInteger(origin.width) ||
    !Number.isSafeInteger(origin.height) ||
    origin.width <= 0 ||
    origin.height <= 0 ||
    !frozenEvidenceIsComplete(origin.screenshot, "image/png") ||
    !frozenEvidenceIsComplete(origin.accessibilityTree, "application/json") ||
    !frozenEvidenceIsComplete(proof.attestation, "application/json")
  ) {
    return undefined;
  }
  return origin;
}
