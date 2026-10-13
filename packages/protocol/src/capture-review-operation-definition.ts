import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";
import {
  captureReviewInputParser,
  captureReviewOutputParser,
} from "./capture-review-operation-parser.js";
const { command } = createOperationBuilders<Pick<RelayOperationMap, "run.capture.review">>();
export const captureReviewOperationDefinition = command(
  "run.capture.review",
  "Review a captured screenshot",
  "POST",
  "/runs/:runId/capture-review",
  {
    category: "evidence",
    confirmation: "confirm",
    input: captureReviewInputParser,
    output: captureReviewOutputParser,
  },
);
