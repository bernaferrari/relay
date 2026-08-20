import type { AppMapOperationMap } from "./app-map-operation-map.js";
import type { AppMapParserDependencies } from "./app-map-operation-parsers.js";
import type { OperationRecord } from "./operation-contract.js";
import {
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
} from "./reviewed-document-origin.js";

type Input<Id extends keyof AppMapOperationMap> = AppMapOperationMap[Id]["input"];
type Output<Id extends keyof AppMapOperationMap> = AppMapOperationMap[Id]["output"];

function selection(
  input: OperationRecord,
  dependencies: AppMapParserDependencies,
  label: string,
): void {
  const { string } = dependencies;
  string(input.appMapId, `${label} appMapId`);
  string(input.screenId, `${label} screenId`);
  string(input.variantId, `${label} variantId`);
  string(input.captureId, `${label} captureId`);
}

function decision(
  input: OperationRecord,
  dependencies: AppMapParserDependencies,
  label: string,
  assertion: string,
): void {
  const { fail, string } = dependencies;
  string(input.reason, `${label} reason`);
  string(input.assertion, `${label} assertion`);
  if ((input.reason as string).trim().length > 1_000) {
    fail(`${label} reason`, "must be at most 1000 characters");
  }
  if (input.assertion !== assertion) {
    fail(`${label} assertion`, `must be exactly ${assertion}`);
  }
  if (input.confirmation !== REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION) {
    fail(`${label} confirmation`, `must be exactly ${REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION}`);
  }
}

/** Kept beside the reviewed-origin contract so the broad App Map parser stays
 * a registry rather than becoming a second review-state implementation. */
export function createAppMapReviewedOriginParsers(dependencies: AppMapParserDependencies) {
  const { number, objectParser, record, string } = dependencies;
  const appMapReviewedDocumentOriginInspectParser = objectParser<
    Input<"app-map.scroll-surface.origin.inspect">
  >("reviewed scroll-surface origin inspection", (input) => {
    selection(input, dependencies, "reviewed scroll-surface origin inspection");
  });
  const appMapReviewedDocumentOriginInspectOutputParser = objectParser<
    Output<"app-map.scroll-surface.origin.inspect">
  >("reviewed scroll-surface origin inspection response", (output) => {
    record(output.inspection, "reviewed scroll-surface origin inspection");
  });
  const appMapReviewedDocumentOriginReviewParser = objectParser<
    Input<"app-map.scroll-surface.origin.review">
  >("reviewed scroll-surface origin approval", (input) => {
    selection(input, dependencies, "reviewed scroll-surface origin approval");
    number(input.expectedRevision, "reviewed scroll-surface origin approval expectedRevision");
    decision(
      input,
      dependencies,
      "reviewed scroll-surface origin approval",
      REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
    );
  });
  const appMapReviewedDocumentOriginReviewOutputParser = objectParser<
    Output<"app-map.scroll-surface.origin.review">
  >("reviewed scroll-surface origin approval response", (output) => {
    record(output.projection, "reviewed scroll-surface origin projection");
    record(output.ledger, "reviewed scroll-surface origin ledger");
    if (typeof output.alreadyActive !== "boolean") {
      throw new TypeError("reviewed scroll-surface origin alreadyActive must be boolean");
    }
  });
  const appMapReviewedDocumentOriginRevokeParser = objectParser<
    Input<"app-map.scroll-surface.origin.revoke">
  >("reviewed scroll-surface origin revocation", (input) => {
    selection(input, dependencies, "reviewed scroll-surface origin revocation");
    string(input.projectionId, "reviewed scroll-surface origin revocation projectionId");
    number(input.expectedRevision, "reviewed scroll-surface origin revocation expectedRevision");
    decision(
      input,
      dependencies,
      "reviewed scroll-surface origin revocation",
      REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
    );
  });
  const appMapReviewedDocumentOriginRevokeOutputParser = objectParser<
    Output<"app-map.scroll-surface.origin.revoke">
  >("reviewed scroll-surface origin revocation response", (output) => {
    record(output.projection, "reviewed scroll-surface origin projection");
    record(output.ledger, "reviewed scroll-surface origin ledger");
    if (typeof output.alreadyRevoked !== "boolean") {
      throw new TypeError("reviewed scroll-surface origin alreadyRevoked must be boolean");
    }
  });
  return {
    appMapReviewedDocumentOriginInspectParser,
    appMapReviewedDocumentOriginInspectOutputParser,
    appMapReviewedDocumentOriginReviewParser,
    appMapReviewedDocumentOriginReviewOutputParser,
    appMapReviewedDocumentOriginRevokeParser,
    appMapReviewedDocumentOriginRevokeOutputParser,
  };
}
