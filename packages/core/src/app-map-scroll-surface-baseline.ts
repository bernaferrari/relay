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
  AppMap,
  LogicalScrollSurface,
  ReviewedDocumentOriginExecutionReference,
  ReviewedDocumentOriginProjection,
  ScrollSurfaceEvidence,
  ScrollSurfaceDocumentOriginProof,
  ScrollSurfaceViewport,
} from "@relay/protocol";
import { reviewedDocumentOriginReferenceForSurface } from "./reviewed-document-origin.js";

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
function frozenRawDocumentOrigin(surface: LogicalScrollSurface): ScrollSurfaceViewport | undefined {
  const origin = surface.viewports[0];
  if (
    !origin ||
    origin.index !== 0 ||
    origin.offsetY !== 0 ||
    origin.appendedHeight !== 0 ||
    !Number.isSafeInteger(origin.capturedAt) ||
    !Number.isSafeInteger(origin.width) ||
    !Number.isSafeInteger(origin.height) ||
    origin.width <= 0 ||
    origin.height <= 0 ||
    !frozenEvidenceIsComplete(origin.screenshot, "image/png") ||
    !frozenEvidenceIsComplete(origin.accessibilityTree, "application/json")
  ) {
    return undefined;
  }
  return origin;
}

export function frozenDocumentOrigin(
  surface: LogicalScrollSurface,
): ScrollSurfaceViewport | undefined {
  const origin = frozenRawDocumentOrigin(surface);
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
    !frozenEvidenceIsComplete(proof.attestation, "application/json") ||
    proof.firstViewport.screenshotSha256 !== origin.screenshot.sha256 ||
    proof.firstViewport.accessibilityTreeSha256 !== origin.accessibilityTree.sha256
  ) {
    return undefined;
  }
  return origin;
}

export type ScrollSurfaceDocumentOriginPlan = {
  documentOrigin: ScrollSurfaceViewport;
  documentOriginProof?: ScrollSurfaceDocumentOriginProof;
  reviewedDocumentOrigin?: ReviewedDocumentOriginExecutionReference;
};

/** Native capture receipts are stronger than a manual reviewed overlay and
 * always win. The reviewed path is only a bootstrap for legacy/imported raw
 * evidence after the server has independently authenticated the sidecar. */
export function scrollSurfaceDocumentOriginPlan(input: {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  surface: LogicalScrollSurface;
  reviewedDocumentOrigins?: readonly ReviewedDocumentOriginProjection[];
}): ScrollSurfaceDocumentOriginPlan | undefined {
  const native = frozenDocumentOrigin(input.surface);
  if (native && input.surface.documentOriginProof) {
    return {
      documentOrigin: native,
      documentOriginProof: structuredClone(input.surface.documentOriginProof),
    };
  }
  const raw = frozenRawDocumentOrigin(input.surface);
  const reviewedDocumentOrigin = reviewedDocumentOriginReferenceForSurface({
    appMap: input.appMap,
    screenId: input.screenId,
    variantId: input.variantId,
    surface: input.surface,
    projections: input.reviewedDocumentOrigins,
  });
  return raw && reviewedDocumentOrigin
    ? { documentOrigin: raw, reviewedDocumentOrigin }
    : undefined;
}
