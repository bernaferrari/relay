import assert from "node:assert/strict";
import test from "node:test";

import { snapshotFromJob } from "./job-projection.js";

const frozen = {
  appMapId: "slice4-reference",
  appMapRevision: 3,
  testId: "test-member-v2",
} as Parameters<typeof snapshotFromJob>[0]["frozen"];

function job(input: { status: string; artifacts?: Array<{ kind: string; data?: unknown }> }) {
  return {
    id: "run-1",
    action: "app-map.test.run",
    queuedAt: 1,
    ...input,
  };
}

test("terminal run with pending captures reports review obligations without failing the phase", () => {
  const snapshot = snapshotFromJob({
    frozen,
    job: job({
      status: "ok",
      artifacts: [
        { kind: "capture-review", data: { status: "pending", framePath: "frames/001.png" } },
        { kind: "capture-review", data: { status: "accepted", framePath: "frames/002.png" } },
        { kind: "campaign-check-result", data: { status: "passed" } },
      ],
    }),
  });
  assert.equal(snapshot.phase, "succeeded");
  assert.deepEqual(snapshot.review, { pending: 1, decided: 1 });
  const problem = snapshot.problems.find(({ code }) => code === "review-required");
  assert.ok(problem, "expected a review-required problem");
  assert.match(problem.title, /1 capture awaits human review/);
  // The undecided capture keeps the run inspectable as the next action.
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
});

test("terminal run with every capture decided reports zero pending and no review problem", () => {
  const snapshot = snapshotFromJob({
    frozen,
    job: job({
      status: "ok",
      artifacts: [
        { kind: "capture-review", data: { status: "accepted" } },
        { kind: "capture-review", data: { status: "issue" } },
      ],
    }),
  });
  assert.equal(snapshot.phase, "succeeded");
  assert.deepEqual(snapshot.review, { pending: 0, decided: 2 });
  assert.equal(
    snapshot.problems.some(({ code }) => code === "review-required"),
    false,
  );
});

test("a run without reviewable captures stays exactly as verifiable as before", () => {
  const snapshot = snapshotFromJob({
    frozen,
    job: job({ status: "ok", artifacts: [{ kind: "campaign-check-result", data: {} }] }),
  });
  assert.equal(snapshot.review, undefined);
  assert.equal(snapshot.problems.length, 0);
});

test("active runs never claim review incompleteness", () => {
  for (const status of ["queued", "running", "paused"]) {
    const snapshot = snapshotFromJob({
      frozen,
      job: job({
        status,
        artifacts: [{ kind: "capture-review", data: { status: "pending" } }],
      }),
    });
    assert.equal(snapshot.review?.pending, 1);
    assert.equal(
      snapshot.problems.some(({ code }) => code === "review-required"),
      false,
      `${status} runs are still collecting; review is not yet incomplete`,
    );
  }
});
