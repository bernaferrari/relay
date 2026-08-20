import { ApiError } from "@relay/client";
import assert from "node:assert/strict";
import test from "node:test";
import { relayMcpError } from "./errors.js";

test("an iOS terminal code is review-needed even when its mutation diagnostic is malformed", () => {
  const result = relayMcpError(
    "target.interact",
    new ApiError(409, "Refresh and retry", {
      code: "IOS_MUTATION_OUTCOME_UNKNOWN",
      error: "Refresh and retry the tap.",
      iosMutation: "not-a-structured-diagnostic",
      switcherScan: { status: "interrupted", phase: "entry-path" },
      recovery: { action: "refresh-and-retry", retryable: true },
      recoveryAction: {
        operationId: "target.interact",
        input: { serial: "ipad-1", kind: "label", label: "Settings" },
      },
    }),
  );

  assert.deepEqual(result, {
    operationId: "target.interact",
    status: 409,
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    message:
      "Review needed: Relay cannot confirm whether the iOS command reached the device. Capture the current screen before any explicit retry or repair.",
    terminal: "review-needed",
    recovery: { action: "none", retryable: false },
    iosReview: { switcherScan: { status: "interrupted", phase: "entry-path" } },
  });
});

test("ordinary conflicts retain their normal recovery behavior", () => {
  const recoveryAction = {
    operationId: "target.interact",
    input: { serial: "ipad-1", kind: "label", label: "Settings" },
  };
  const result = relayMcpError(
    "target.interact",
    new ApiError(409, "Revision changed", {
      code: "revision_conflict",
      error: "Refresh the map before retrying.",
      iosMutation: "not-a-structured-diagnostic",
      recovery: { action: "refresh-and-retry", retryable: true },
      recoveryAction,
    }),
  );

  assert.deepEqual(result, {
    operationId: "target.interact",
    status: 409,
    code: "revision_conflict",
    message: "Refresh the map before retrying.",
    recovery: { action: "refresh-and-retry", retryable: true },
    recoveryAction,
  });
});
