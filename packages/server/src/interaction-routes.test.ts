import assert from "node:assert/strict";
import test from "node:test";
import { IosMutationOutcomeUnknownError } from "@relay/core";
import { HttpError } from "./http.js";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";

test("the interaction boundary preserves an iOS one-command intervention for app and MCP callers", () => {
  const error = new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("connection reset"),
  );

  const response = iosMutationOutcomeUnknownHttpError(error);
  assert.ok(response instanceof HttpError);
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    iosMutation: error.iosMutation,
  });
});
