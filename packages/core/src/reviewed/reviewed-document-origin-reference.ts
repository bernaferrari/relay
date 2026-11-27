import type {
  AppMap,
  LogicalScrollSurface,
  ReviewedDocumentOriginExecutionReference,
  ReviewedDocumentOriginProjection,
} from "@relay/protocol";
import {
  reviewedDocumentOriginAppMapDigest,
  sameReviewedDocumentOriginEvidence,
} from "./reviewed-document-origin-evidence-primitives.js";

export function reviewedDocumentOriginReferenceForSurface(input: {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  surface: LogicalScrollSurface;
  projections: readonly ReviewedDocumentOriginProjection[] | undefined;
}): ReviewedDocumentOriginExecutionReference | undefined {
  if (!input.projections?.length) return undefined;
  const first = input.surface.viewports[0];
  if (!first) return undefined;
  const projection = input.projections.find((candidate) => {
    const binding = candidate.binding;
    return (
      binding.organizationId === input.appMap.organizationId &&
      binding.projectId === input.appMap.projectId &&
      binding.appMapId === input.appMap.id &&
      binding.appMapRevision === input.appMap.revision &&
      binding.appMapDigest === reviewedDocumentOriginAppMapDigest(input.appMap) &&
      binding.platform === "android" &&
      binding.screenId === input.screenId &&
      binding.variantId === input.variantId &&
      binding.surfaceId === input.surface.id &&
      binding.captureId === input.surface.captureId &&
      binding.targetProfileId === input.surface.targetProfileId &&
      binding.firstViewport.index === first.index &&
      binding.firstViewport.offsetY === first.offsetY &&
      binding.firstViewport.appendedHeight === first.appendedHeight &&
      binding.firstViewport.capturedAt === first.capturedAt &&
      binding.firstViewport.width === first.width &&
      binding.firstViewport.height === first.height &&
      sameReviewedDocumentOriginEvidence(binding.firstViewport.screenshot, first.screenshot) &&
      sameReviewedDocumentOriginEvidence(
        binding.firstViewport.accessibilityTree,
        first.accessibilityTree,
      )
    );
  });
  return projection ? { schemaVersion: 1, projection: structuredClone(projection) } : undefined;
}
