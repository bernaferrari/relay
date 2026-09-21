import assert from "node:assert/strict";
import test from "node:test";

import { assertOutcomeSucceeded } from "./index.js";
import { CliError, ExitCode } from "./errors.js";
import type { RunTestSnapshot } from "@relay/workflows";

function snapshot(input: Partial<RunTestSnapshot>): RunTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: "Run test-member-v2",
    phase: "succeeded",
    version: "job-v1-test",
    progress: { label: "Test completed" },
    allowedNextActions: ["inspect"],
    problems: [],
    evidenceRefs: [{ kind: "run", id: "run-77" }],
    ...input,
  };
}

test("a completed run with undecided review captures fails closed at exit 10, not zero", () => {
  assert.throws(
    () =>
      assertOutcomeSucceeded(
        snapshot({
          review: { pending: 2, decided: 1 },
          problems: [
            {
              code: "review-required",
              title: "2 captures await human review",
              detail: "Collection completed, but acceptance is not final.",
              recovery: "Review the run's captures, then rerun this command.",
              retryable: false,
            },
          ],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.exitCode, ExitCode.verificationIncomplete);
      assert.match(error.message, /2 captures still require human review/);
      return true;
    },
  );
});

test("a completed run with every capture decided stays a plain success", () => {
  const decided = snapshot({ review: { pending: 0, decided: 3 } });
  assertOutcomeSucceeded(decided);
  const withoutReview = snapshot({});
  assertOutcomeSucceeded(withoutReview);
});

test("one undecided capture is still incomplete, and failure still wins over review", () => {
  assert.throws(
    () => assertOutcomeSucceeded(snapshot({ review: { pending: 1, decided: 0 } })),
    (error: unknown) =>
      error instanceof CliError && error.exitCode === ExitCode.verificationIncomplete,
  );
  // A failed phase keeps exit 9 even when review is also pending.
  assert.throws(
    () =>
      assertOutcomeSucceeded(
        snapshot({
          phase: "failed",
          review: { pending: 1, decided: 0 },
          problems: [
            {
              code: "operation-unavailable",
              title: "The test did not complete",
              detail: "error",
              recovery: "Inspect the run evidence.",
              retryable: false,
            },
          ],
        }),
      ),
    (error: unknown) => error instanceof CliError && error.exitCode === ExitCode.operationFailure,
  );
});
