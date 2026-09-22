import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@relay/client";
import { projectError } from "./errors";

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
