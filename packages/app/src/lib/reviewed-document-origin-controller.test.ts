import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  type ReviewedDocumentOriginInspection,
} from "@relay/protocol";
import {
  createReviewedDocumentOriginController,
  type ReviewedDocumentOriginTransport,
} from "./reviewed-document-origin-controller.js";

const selection = {
  appMapId: "settings-map",
  screenId: "settings",
  variantId: "settings-en",
  captureId: "capture-1",
  expectedRevision: 7,
};

test("uses only canonical reviewed-origin operations with exact signed-decision inputs", async () => {
  const calls: Array<{ operationId: string; input: unknown }> = [];
  const inspection = {
    appMapId: selection.appMapId,
    screenId: selection.screenId,
    variantId: selection.variantId,
    captureId: selection.captureId,
    lineage: [],
  } as ReviewedDocumentOriginInspection;
  const transport = {
    runAction: async (operationId: string, input: unknown) => {
      calls.push({ operationId, input });
      if (operationId === "app-map.scroll-surface.origin.inspect") return { inspection };
      return {
        projection: { id: "reviewed-origin-1" },
        ledger: { status: operationId.endsWith("revoke") ? "revoked" : "active" },
        ...(operationId.endsWith("revoke") ? { alreadyRevoked: false } : { alreadyActive: false }),
      };
    },
  } as ReviewedDocumentOriginTransport;
  const controller = createReviewedDocumentOriginController(transport);

  assert.deepEqual(await controller.inspect(selection), inspection);
  await controller.review(selection, {
    reason: "The immutable first frame is visibly at the settings document top.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
    confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  });
  await controller.revoke(selection, "reviewed-origin-1", {
    reason: "A deliberate review is withdrawing this local authority.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
    confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  });

  assert.deepEqual(calls, [
    {
      operationId: "app-map.scroll-surface.origin.inspect",
      input: {
        appMapId: "settings-map",
        screenId: "settings",
        variantId: "settings-en",
        captureId: "capture-1",
      },
    },
    {
      operationId: "app-map.scroll-surface.origin.review",
      input: {
        ...selection,
        reason: "The immutable first frame is visibly at the settings document top.",
        assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
        confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
      },
    },
    {
      operationId: "app-map.scroll-surface.origin.revoke",
      input: {
        ...selection,
        projectionId: "reviewed-origin-1",
        reason: "A deliberate review is withdrawing this local authority.",
        assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
        confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
      },
    },
  ]);
  assert.deepEqual(
    new Set(calls.map((call) => call.operationId)),
    new Set([
      "app-map.scroll-surface.origin.inspect",
      "app-map.scroll-surface.origin.review",
      "app-map.scroll-surface.origin.revoke",
    ]),
  );
});
