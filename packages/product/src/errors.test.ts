import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@relay/client";
import { projectError } from "./errors.js";

for (const [status, title, guidance] of [
  [401, "Reconnect to Relay", /connection settings/],
  [403, "You don’t have access to this action", /workspace owner/],
  [404, "This item is unavailable", /previous page/],
  [409, "This action conflicts with the current state", /latest state/],
  [429, "Relay needs a moment", /Wait a moment/],
  [400, "Relay could not accept this request", /selections/],
  [422, "Relay could not accept this request", /selections/],
  [418, "Relay could not accept this request", /selections/],
] as const) {
  test(`plain ${status} failures offer useful guidance without an immediate retry`, () => {
    const projected = projectError(new ApiError(status, "private internal transport detail", {}));
    assert.equal(projected.title, title);
    assert.match(projected.recovery, guidance);
    assert.equal(projected.retryable, false);
    assert.doesNotMatch(
      JSON.stringify(projected),
      /HTTP|private internal|401|403|404|409|429|422|418/,
    );
  });
}

test("structured server recovery takes precedence over status-based advice", () => {
  const problem = {
    title: "Review the current run",
    detail: "The run may already have started.",
    recovery: "Check its status before starting another run.",
    retryable: false,
  };
  for (const status of [401, 403, 404, 409, 429, 500]) {
    assert.deepEqual(projectError(new ApiError(status, "ignored", { error: problem })), problem);
  }
});

test("unstructured server errors hide transport details", () => {
  const projected = projectError(new ApiError(500, "private server stack trace", {}));
  assert.equal(projected.retryable, true);
  assert.doesNotMatch(JSON.stringify(projected), /HTTP|500|stack trace/);
});

test("captured setup conflict preserves the canonical affected step without leaking device facts", () => {
  const details = {
    code: "target-profile-ambiguous",
    testId: "test-speed",
    stepId: "step-d950-source",
    diagnostics: [],
    recovery: "Open the test editor and resolve its blocking compile diagnostics.",
  };
  for (const body of [
    {
      error:
        "Saved target profile device:private-phone:1080x2340 has conflicting route-selection facts",
      ...details,
    },
    {
      error:
        "Saved target profile device:private-phone:1080x2340 has conflicting route-selection facts",
      ...details,
      details: { context: "unrelated" },
    },
    {
      error:
        "Saved target profile device:private-phone:1080x2340 has conflicting route-selection facts",
      details,
    },
  ]) {
    const projected = projectError(new ApiError(409, body.error, body));
    assert.equal(projected.title, "Saved setup needs review");
    assert.equal(projected.sourceCode, "target-profile-ambiguous");
    assert.equal(projected.sourceStepId, "step-d950-source");
    assert.equal(projected.retryable, false);
    assert.match(projected.recovery, /affected step’s capture/u);
    assert.doesNotMatch(JSON.stringify(projected), /private-phone|1080x2340|route-selection/u);
  }
});

test("a malformed optional source step does not crash captured setup recovery", () => {
  const projected = projectError({
    sourceCode: "target-profile-ambiguous",
    sourceStepId: 42,
    title: "Internal failure",
    detail: "private device facts",
    recovery: "Compile again",
    retryable: true,
  });
  assert.equal(projected.title, "Saved setup needs review");
  assert.equal(projected.sourceStepId, undefined);
  assert.equal(projected.retryable, false);
});

test("browser setup selection recovery keeps its existing public explanation", () => {
  const problem = {
    code: "compile-blocked",
    sourceCode: "browser-target-profile-selection-required",
    title: "This browser’s setup changed since recording",
    detail: "The test was recorded with a different browser setup.",
    recovery: "Record the test again on this browser, or restore its previous setup in Devices.",
    retryable: false,
  };
  const { code: _code, ...expected } = problem;
  assert.deepEqual(projectError(problem), expected);
});
