import type {
  OperationInput,
  OperationOutput,
  ReviewedDocumentOriginInspection,
} from "@relay/protocol";

/**
 * The App Map UI gets exactly these three offline reviewed-origin operations.
 * Keeping the narrow transport here makes it impossible for a review panel to
 * accidentally grow a capture, target lookup, polling, or device-control path.
 */
export type ReviewedDocumentOriginTransport = {
  runAction(
    operationId: "app-map.scroll-surface.origin.inspect",
    input: OperationInput<"app-map.scroll-surface.origin.inspect">,
  ): Promise<OperationOutput<"app-map.scroll-surface.origin.inspect">>;
  runAction(
    operationId: "app-map.scroll-surface.origin.review",
    input: OperationInput<"app-map.scroll-surface.origin.review">,
  ): Promise<OperationOutput<"app-map.scroll-surface.origin.review">>;
  runAction(
    operationId: "app-map.scroll-surface.origin.revoke",
    input: OperationInput<"app-map.scroll-surface.origin.revoke">,
  ): Promise<OperationOutput<"app-map.scroll-surface.origin.revoke">>;
};

export type ReviewedDocumentOriginSelection = {
  appMapId: string;
  screenId: string;
  variantId: string;
  captureId: string;
  expectedRevision: number;
};

export type ReviewedDocumentOriginReviewDecision = Pick<
  OperationInput<"app-map.scroll-surface.origin.review">,
  "reason" | "assertion" | "confirmation"
>;

export type ReviewedDocumentOriginRevocationDecision = Pick<
  OperationInput<"app-map.scroll-surface.origin.revoke">,
  "reason" | "assertion" | "confirmation"
>;

/** Canonical-only origin transport. It deliberately has no generic request,
 * device, lease, or capture method to keep review work offline and auditable. */
export function createReviewedDocumentOriginController(input: ReviewedDocumentOriginTransport) {
  return {
    async inspect(
      selection: Omit<ReviewedDocumentOriginSelection, "expectedRevision">,
    ): Promise<ReviewedDocumentOriginInspection> {
      return (
        await input.runAction("app-map.scroll-surface.origin.inspect", {
          appMapId: selection.appMapId,
          screenId: selection.screenId,
          variantId: selection.variantId,
          captureId: selection.captureId,
        })
      ).inspection;
    },
    review(
      selection: ReviewedDocumentOriginSelection,
      decision: ReviewedDocumentOriginReviewDecision,
    ) {
      return input.runAction("app-map.scroll-surface.origin.review", {
        ...selection,
        ...decision,
      });
    },
    revoke(
      selection: ReviewedDocumentOriginSelection,
      projectionId: string,
      decision: ReviewedDocumentOriginRevocationDecision,
    ) {
      return input.runAction("app-map.scroll-surface.origin.revoke", {
        ...selection,
        projectionId,
        ...decision,
      });
    },
  };
}
