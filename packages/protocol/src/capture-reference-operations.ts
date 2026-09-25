import type { CaptureReferenceRegion } from "./capture-reference.js";
import type { CaptureReviewQueue } from "./capture-review.js";
import { createOperationBuilders } from "./operation-builders.js";
import type { RuntimeParser } from "./operation-contract.js";

export type CaptureReferenceOperationMap = {
  "run.capture.reference.compare": {
    input: { runId: string };
    output: { queue: CaptureReviewQueue };
  };
  "run.capture.reference.ignore-regions.update": {
    input: { runId: string; captureId: string; regions: CaptureReferenceRegion[] };
    output: { queue: CaptureReviewQueue };
  };
};

const queueOutput: RuntimeParser<{ queue: CaptureReviewQueue }> = Object.freeze({
  description: "capture reference response",
  parse(value: unknown) {
    const record = value as { queue?: { items?: unknown; summary?: unknown } } | null;
    if (!record?.queue || !Array.isArray(record.queue.items) || !record.queue.summary) {
      throw new Error("capture reference response must include the review queue");
    }
    return record as { queue: CaptureReviewQueue };
  },
});

const { command } = createOperationBuilders<CaptureReferenceOperationMap>();

export const captureReferenceOperationDefinitions = [
  command(
    "run.capture.reference.compare",
    "Compare a Run's screenshots with their references",
    "POST",
    "/runs/:runId/capture-reference/compare",
    { category: "evidence", output: queueOutput },
  ),
  command(
    "run.capture.reference.ignore-regions.update",
    "Set the areas a screenshot comparison ignores",
    "PUT",
    "/runs/:runId/capture-reference/ignore-regions",
    { category: "evidence", confirmation: "confirm", output: queueOutput },
  ),
] as const;
