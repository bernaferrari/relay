import assert from "node:assert/strict";
import test from "node:test";
import { unavailableWorkflowProblem } from "./workflow-problems.js";

test("native legacy profile conflicts retain typed setup recovery through HTTP details", () => {
  for (const code of ["TARGET_PROFILE_AMBIGUOUS", "target-profile-ambiguous"]) {
    const problem = unavailableWorkflowProblem(
      "run this Test",
      Object.assign(new Error("Target profile has conflicting identities"), {
        body: { details: { code, targetProfileId: "device:ipad-1112x834" } },
      }),
    );
    assert.equal(problem.code, "compile-blocked");
    assert.equal(problem.sourceCode, "target-profile-ambiguous");
    assert.equal(problem.title, "Saved setup needs review");
    assert.equal(problem.retryable, false);
    assert.match(problem.recovery, /Test editor/);
  }
});

test("a generic failure mentioning identities does not become a typed setup conflict", () => {
  const problem = unavailableWorkflowProblem(
    "run this Test",
    Object.assign(new Error("Target profile has conflicting identities"), {
      body: { details: { code: "DEVICE_UNAVAILABLE" } },
    }),
  );
  assert.equal(problem.code, "operation-unavailable");
  assert.equal(problem.sourceCode, undefined);
});
