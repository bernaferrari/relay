import type { OperationInput, OperationOutput } from "./operation-map.js";
import { CAPTURE_REVIEW_ACTIONS } from "./capture-review.js";
import { fail, objectParser, record, string } from "./operation-parser-primitives.js";

export const captureReviewInputParser = objectParser<OperationInput<"run.capture.review">>(
  "capture review input",
  (input) => {
    string(input.runId, "capture review runId");
    string(input.captureId, "capture review captureId");
    const action = string(input.action, "capture review action");
    if (!(CAPTURE_REVIEW_ACTIONS as readonly string[]).includes(action)) {
      fail("capture review action", "is unsupported");
    }
    if (input.imageSha256 !== undefined) string(input.imageSha256, "capture review imageSha256");
    if (input.note !== undefined) string(input.note, "capture review note");
    if (input.expectedReviewVersion !== undefined) {
      if (
        typeof input.expectedReviewVersion !== "number" ||
        !Number.isInteger(input.expectedReviewVersion) ||
        input.expectedReviewVersion < 0
      ) {
        fail("capture review expectedReviewVersion", "must be a non-negative integer");
      }
    }
  },
);

export const captureReviewOutputParser = objectParser<OperationOutput<"run.capture.review">>(
  "capture review response",
  (input) => {
    record(input.run, "capture review run");
    record(input.queue, "capture review queue");
    record(input.decision, "capture review decision");
    if (input.referenceUpdate !== undefined) {
      const update = record(input.referenceUpdate, "capture reference update");
      const status = string(update.status, "capture reference update status");
      if (!["updated", "revoked", "unchanged", "failed"].includes(status)) {
        fail("capture reference update status", "is unsupported");
      }
      if (update.message !== undefined) string(update.message, "capture reference update message");
    }
  },
);
