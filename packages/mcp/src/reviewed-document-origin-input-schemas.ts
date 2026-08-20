/** Strict MCP boundary for the offline reviewed-origin authority operations.
 * Keep these separate from the large general registry: authorization fields
 * must never fall back to the permissive presentation schema. */
import {
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  type OperationId,
} from "@relay/protocol";
import * as z from "zod/v4";
import { identifier, text } from "./input-schema-primitives.js";

const selection = {
  appMapId: identifier("App Map identifier"),
  screenId: identifier("Logical screen identifier"),
  variantId: identifier("Target-profile variant identifier"),
  captureId: identifier("Immutable scroll capture identifier"),
};

const decision = {
  expectedRevision: z.number().int().nonnegative().describe("Current App Map revision"),
  reason: text("Why the immutable first viewport was reviewed").max(1_000),
};

export const reviewedDocumentOriginInputSchemas = {
  "app-map.scroll-surface.origin.inspect": z.object(selection).strict(),
  "app-map.scroll-surface.origin.review": z
    .object({
      ...selection,
      ...decision,
      assertion: z
        .literal(REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION)
        .describe("Exact reviewed document-top confirmation"),
    })
    .strict(),
  "app-map.scroll-surface.origin.revoke": z
    .object({
      ...selection,
      ...decision,
      projectionId: identifier("Reviewed-origin projection identifier"),
      assertion: z
        .literal(REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION)
        .describe("Exact reviewed-origin revocation confirmation"),
    })
    .strict(),
} satisfies Partial<Record<OperationId, z.ZodObject>>;
