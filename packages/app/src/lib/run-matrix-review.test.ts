import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import {
  currentLocaleRetry,
  filterRunMatrixRows,
  isRunMatrixJob,
  matrixReviewPageSize,
  pageRunMatrixRows,
  problemRetryLabel,
  projectRunMatrix,
  stepIndexForMatrixCapture,
} from "./run-matrix-review";

function job(input: Partial<JobInfo> & Pick<JobInfo, "id" | "status">): JobInfo {
  return {
    action: "combine-language-tour",
    queuedAt: 1,
    logs: [],
    ...input,
  } as JobInfo;
}

test("projects one Variable row by screenshot column without exposing selector helpers", () => {
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
          expectedScreenshots: 2,
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
  assert.equal(review.missingCaptures, 1);
  assert.equal(review.problemRuns, 1);
  assert.equal(problemRetryLabel(review), "Retry 1 problem locale");
  assert.deepEqual(review.insights, [
    { kind: "failure", label: "language: Italiano", count: 1, detail: "1 failed run" },
    { kind: "missing-capture", label: "Widget", count: 1, detail: "Missing in 1 run" },
  ]);
  assert.equal(isRunMatrixJob(first), true);
  assert.equal(stepIndexForMatrixCapture(first, 0), 0);
});

test("problem retry copy stays generic for non-locale matrices", () => {
  const review = projectRunMatrix([
    job({
      id: "dark",
      status: "error",
      matrixCase: { kind: "combine", world: "Dark", values: { theme: "Dark" } },
    }),
  ]);
  assert.ok(review);
  assert.equal(problemRetryLabel(review), "Retry 1 problem run");
});

test("recompiles only problem locale values from one saved matrix", () => {
  const review = projectRunMatrix([
    job({
      id: "en",
      status: "ok",
      matrixCase: {
        kind: "combine",
        appMapId: "settings",
        combineId: "language-x-tour",
        world: "English",
        values: { language: "en", language_label: "English" },
      },
    }),
    job({
      id: "it",
      status: "error",
      matrixCase: {
        kind: "combine",
        appMapId: "settings",
        combineId: "language-x-tour",
        world: "Italiano",
        values: { language: "it", language_label: "Italiano" },
      },
    }),
    job({
      id: "de",
      status: "error",
      matrixCase: {
        kind: "combine",
        appMapId: "settings",
        combineId: "language-x-tour",
        world: "Deutsch",
        values: { language: "de", language_label: "Deutsch" },
      },
    }),
  ]);
  assert.ok(review);
  assert.deepEqual(currentLocaleRetry(review), {
    appMapId: "settings",
    combineId: "language-x-tour",
    selected: { language: ["it", "de"] },
  });
});

test("does not expand multi-dimensional failures into unintended combinations", () => {
  const review = projectRunMatrix([
    job({
      id: "it-dark",
      status: "error",
      matrixCase: {
        kind: "combine",
        appMapId: "settings",
        combineId: "language-theme-tour",
        world: "Italiano · Dark",
        values: { language: "it", theme: "dark" },
      },
    }),
  ]);
  assert.ok(review);
  assert.equal(currentLocaleRetry(review), null);
});

test("filters problems and Variable values without mutating the review", () => {
  const review = projectRunMatrix([
    job({
      id: "en",
      status: "ok",
      matrixCase: { kind: "combine", world: "English", values: { language: "English" } },
    }),
    job({
      id: "it",
      status: "error",
      matrixCase: {
        kind: "combine",
        world: "Italiano",
        values: { language: "Italiano" },
        expectedScreenshots: 2,
      },
    }),
  ]);
  assert.ok(review);
  assert.deepEqual(
    filterRunMatrixRows(review, { query: "ital" }).map((row) => row.job.id),
    ["it"],
  );
  assert.deepEqual(
    filterRunMatrixRows(review, { problemsOnly: true }).map((row) => row.job.id),
    ["it"],
  );
  assert.equal(review.rows.length, 2);
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

test("keeps operational before and after frames in replay but out of screenshot review", () => {
  const review = projectRunMatrix([
    job({
      id: "en",
      status: "ok",
      frames: [
        { path: "before.png", caption: "before · Set locale", capturedAt: 1 },
        { path: "after.png", caption: "after · Set locale", capturedAt: 2 },
        { path: "settings.png", caption: "screen:Settings", capturedAt: 3 },
        { path: "widget.png", caption: "tour:Widget", capturedAt: 4 },
      ],
      matrixCase: {
        kind: "combine",
        world: "English",
        values: { language: "en" },
        expectedScreenshots: 2,
      },
    }),
  ]);

  assert.ok(review);
  assert.deepEqual(review.captureLabels, ["Settings", "Widget"]);
  assert.deepEqual(
    review.rows[0]?.captures.map((capture) => capture.index),
    [2, 3],
    "capture indices must continue to address the original replay frames",
  );
  assert.equal(review.missingCaptures, 0);
});

test("keeps a large dynamic screenshot matrix bounded for screen-first review", () => {
  const runs = Array.from({ length: 45 }, (_, valueIndex) =>
    job({
      id: `locale-${valueIndex + 1}`,
      caseIndex: valueIndex,
      status: "ok",
      frames: Array.from({ length: 10 }, (_, screenIndex) => ({
        path: `locale-${valueIndex + 1}-screen-${screenIndex + 1}.png`,
        caption: `screen:Screen ${screenIndex + 1}`,
        capturedAt: screenIndex + 1,
      })),
      matrixCase: {
        kind: "combine",
        world: `Locale ${valueIndex + 1}`,
        values: { language: `locale-${valueIndex + 1}` },
        expectedScreenshots: 10,
      },
    }),
  );

  const review = projectRunMatrix(runs);
  assert.ok(review);
  assert.equal(review.rows.length, 45);
  assert.equal(review.captureLabels.length, 10);
  assert.equal(
    review.rows.reduce((total, row) => total + row.captures.length, 0),
    450,
  );
  assert.equal(pageRunMatrixRows(review.rows).length, matrixReviewPageSize);
  assert.equal(pageRunMatrixRows(review.rows, 24).length, 24);
  assert.equal(review.rows.length, 45, "paging must not remove export evidence");
});
