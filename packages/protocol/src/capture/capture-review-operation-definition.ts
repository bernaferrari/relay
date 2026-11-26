import { createSchemaOperationBuilders } from "../operation/operation-builders.js";
const { command } = createSchemaOperationBuilders<"run.capture.review">();
export const captureReviewOperationDefinition = command(
  "run.capture.review",
  "Review a captured screenshot",
  "POST",
  "/runs/:runId/capture-review",
  {
    category: "evidence",
    confirmation: "confirm",
  },
);
