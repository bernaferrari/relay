import type { OperationInput } from "./operation-map.js";
import { fail, number, objectParser, string } from "./operation-parser-primitives.js";

export const runEvidenceInputParser = objectParser<OperationInput<"run.evidence.get">>(
  "run evidence input",
  (input) => {
    string(input.runId, "run id");
    if (input.limit !== undefined) {
      const rawLimit =
        typeof input.limit === "string"
          ? Number(input.limit)
          : number(input.limit, "run evidence limit");
      const limit = rawLimit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) {
        fail("run evidence limit", "must be an integer between 1 and 2000");
      }
    }
    if (input.includeBodies !== undefined) {
      if (
        input.includeBodies !== true &&
        input.includeBodies !== false &&
        input.includeBodies !== "true" &&
        input.includeBodies !== "false"
      ) {
        fail("includeBodies", "must be a boolean");
      }
    }
    if (input.testStepId !== undefined) string(input.testStepId, "authored Test step id");
  },
);
