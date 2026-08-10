import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import { isRunMatrixJob, projectRunMatrix, stepIndexForMatrixCapture } from "./run-matrix-review";

function job(input: Partial<JobInfo> & Pick<JobInfo, "id" | "status">): JobInfo {
  return {
    action: "combine-language-tour",
    queuedAt: 1,
    logs: [],
    ...input,
  } as JobInfo;
}

test("projects one modifier row by screenshot column without exposing selector helpers", () => {
  const first = job({
    id: "en",
    status: "ok",
    caseIndex: 0,
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 1,
        data: {
          kind: "combine",
          world: "English",
          values: { language: "en", language_label: "English", language_identifier: "lang.en" },
          expectedScreenshots: 2,
        },
      },
    ],
    frames: [
      { path: "settings.png", caption: "screen:Settings", capturedAt: 2 },
      { path: "widget.png", caption: "tour:Widget", capturedAt: 3 },
    ],
    steps: [
      {
        id: "s1",
        index: 0,
        kind: "screenshot",
        tone: "observe",
        title: "Settings",
        glyphs: [],
        startedAt: 2,
        frames: [{ path: "settings.png", caption: "screen:Settings", capturedAt: 2 }],
        log: "",
      },
    ],
  });
  const second = job({
    id: "it",
    status: "error",
    caseIndex: 1,
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 1,
        data: {
          kind: "combine",
          world: "Italiano",
          values: { language: "it", language_label: "Italiano" },
        },
      },
    ],
    frames: [{ path: "settings-it.png", caption: "screen:Impostazioni", capturedAt: 4 }],
  });
  const review = projectRunMatrix([second, first]);
  assert.ok(review);
  assert.deepEqual(review.captureLabels, ["Settings", "Widget"]);
  assert.deepEqual(review.rows[0]?.values, [{ name: "language", value: "English" }]);
  assert.equal(review.rows[1]?.captures[1]?.frame, undefined);
  assert.equal(review.passed, 1);
  assert.equal(review.failed, 1);
  assert.equal(isRunMatrixJob(first), true);
  assert.equal(stepIndexForMatrixCapture(first, 0), 0);
});

test("reserves expected screenshot columns before live frames arrive", () => {
  const review = projectRunMatrix([
    job({
      id: "queued",
      caseIndex: 0,
      status: "running",
      frames: [{ path: "ask.png", caption: "screen:Ask", capturedAt: 3 }],
      matrixCase: {
        kind: "combine",
        world: "Italiano",
        values: { language: "it" },
        expectedScreenshots: 3,
      },
    }),
  ]);
  assert.equal(review?.captureLabels.length, 3);
  assert.deepEqual(review?.captureLabels, ["Ask", "Screenshot 2", "Screenshot 3"]);
});
