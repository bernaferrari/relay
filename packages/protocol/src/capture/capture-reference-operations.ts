import type { CaptureReferenceRegion, ReviewInboxResult } from "./capture-reference.js";
import type { CaptureReviewQueue } from "./capture-review.js";
import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

export type CaptureReferenceOperationMap = {
  "review.inbox.list": {
    /** countOnly: totals only, without the screenshots (for badges). */
    input: { sinceDays?: number; appMapId?: string; countOnly?: boolean };
    output: ReviewInboxResult;
  };
  "run.capture.reference.compare": {
    input: { runId: string };
    output: { queue: CaptureReviewQueue };
  };
  "run.capture.reference.ignore-regions.update": {
    input: { runId: string; captureId: string; regions: CaptureReferenceRegion[] };
    output: { queue: CaptureReviewQueue };
  };
};

const { command, query } = createSchemaOperationBuilders<keyof CaptureReferenceOperationMap>();

export const captureReferenceOperationDefinitions = [
  query("review.inbox.list", "List screenshots waiting for review", "/review/inbox", {
    category: "evidence",
  }),
  command(
    "run.capture.reference.compare",
    "Compare a Run's screenshots with their references",
    "POST",
    "/runs/:runId/capture-reference/compare",
    {
      category: "evidence",
    },
  ),
  command(
    "run.capture.reference.ignore-regions.update",
    "Set the areas a screenshot comparison ignores",
    "PUT",
    "/runs/:runId/capture-reference/ignore-regions",
    {
      category: "evidence",
      confirmation: "confirm",
    },
  ),
] as const;
