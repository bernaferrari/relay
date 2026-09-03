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

test("suppresses a recovery operation hidden by the selected MCP profile", () => {
  const result = relayMcpError(
    "target.interact",
    new ApiError(403, "This target is currently controlled by another actor", {
      code: "TARGET_CONTROL_LEASE_CONFLICT",
      recovery: { action: "request-access", retryable: false },
      recoveryAction: {
        operationId: "lease.takeover",
        input: { leaseId: "lease-1" },
      },
    }),
    {
      profile: "control",
      availableOperationIds: new Set(["target.interact"]),
      availableProfilesForOperation: () => ["full"],
      currentOperationAvailable: true,
    },
  );

  assert.equal(result.recoveryAction, undefined);
  assert.match(result.recoveryGuidance ?? "", /lease\.takeover/u);
  assert.match(result.recoveryGuidance ?? "", /selected MCP profile "control"/u);
  assert.match(result.recoveryGuidance ?? "", /canonical operation/u);
});

test("turns hidden lease acquisition into an operator handoff", () => {
  const result = relayMcpError(
    "target.interact",
    new ApiError(403, "Take control of this target before sending device input", {
      code: "TARGET_CONTROL_LEASE_REQUIRED",
      recovery: { action: "acquire-lease", retryable: true },
    }),
    {
      profile: "observe",
      availableOperationIds: new Set(["target.snapshot.capture"]),
      availableProfilesForOperation: () => ["control", "map", "author", "test", "run", "locale"],
    },
  );

  assert.deepEqual(result.recovery, { action: "request-access", retryable: false });
  assert.match(result.recoveryGuidance ?? "", /lease\.create/u);
  assert.match(result.recoveryGuidance ?? "", /selected MCP profile "observe"/u);
});
