import assert from "node:assert/strict";
import test from "node:test";
import { replayInputFromPersistedRun, summarizeJob, type TestJob } from "./session.js";
import { CAPTURE_REVIEW_DEST_PHASE } from "@relay/protocol";

test("job summaries expose only the safe matrix identity needed by live review", () => {
  const job = {
    id: "job-1",
    action: "settings-tour",
    title: "Italiano · Settings",
    status: "running",
    queuedAt: 10,
    startedAt: 20,
    platform: "android",
    targetKind: "device",
    serial: "pixel",
    logs: [],
    frames: [],
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 10,
        data: {
          kind: "combine-cell",
          appMapId: "settings",
          testId: "settings-tour",
          combineId: "language-x-settings",
          world: "Italiano",
          values: { language: "it-IT", language_label: "Italiano" },
          expectedScreenshots: 10,
          privateToken: "must-not-leak",
        },
      },
    ],
    batchId: "batch-1",
    caseIndex: 1,
    caseCount: 2,
  } as unknown as TestJob;

  assert.deepEqual(summarizeJob(job).matrixCase, {
    kind: "combine",
    appMapId: "settings",
    testId: "settings-tour",
    combineId: "language-x-settings",
    world: "Italiano",
    values: { language: "it-IT", language_label: "Italiano" },
    expectedScreenshots: 10,
  });
  assert.equal(JSON.stringify(summarizeJob(job)).includes("must-not-leak"), false);
});

test("job summaries expose bounded campaign check outcomes", () => {
  const job = {
    id: "job-checks",
    action: "settings",
    status: "error",
    queuedAt: 10,
    platform: "android",
    targetKind: "device",
    serial: "pixel",
    logs: [],
    frames: [],
    artifacts: [],
  } as unknown as TestJob;
  job.artifacts.push({
    kind: "campaign-check-result",
    capturedAt: 40,
    data: {
      id: "settings",
      title: "Settings coverage",
      status: "failed",
      error: "path changed",
      startedAt: 10,
      finishedAt: 40,
    },
  });

  assert.deepEqual(summarizeJob(job).checks, [
    {
      id: "settings",
      title: "Settings coverage",
      status: "failed",
      error: "path changed",
      startedAt: 10,
      finishedAt: 40,
      durationMs: 30,
    },
  ]);
});

test("job summaries discard malformed matrix values instead of trusting artifact casts", () => {
  const job = {
    id: "job-2",
    action: "settings-tour",
    status: "queued",
    queuedAt: 10,
    platform: "android",
    targetKind: "device",
    serial: "pixel",
    logs: [],
    frames: [],
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 10,
        data: {
          kind: "combine",
          world: "Italiano",
          values: { language: "it-IT", unsafe: { token: "secret" } },
        },
      },
    ],
  } as unknown as TestJob;

  assert.deepEqual(summarizeJob(job).matrixCase?.values, { language: "it-IT" });
});

test("job summaries dest identity is dest wait-for 003, not leftover Close 004 last-frame", () => {
  const job = {
    id: "4b93702b",
    action: "observe",
    status: "ok",
    queuedAt: 10,
    platform: "browser",
    targetKind: "browser",
    logs: [],
    frames: [
      { path: "frames/003.png", caption: "Observe", capturedAt: 1 },
      { path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 2 },
    ],
    artifacts: [
      {
        kind: "capture-review",
        capturedAt: 1,
        data: {
          caption: "Observe",
          framePath: "frames/003.png",
          phase: CAPTURE_REVIEW_DEST_PHASE,
          policy: "fast",
          status: "pending",
        },
      },
      {
        kind: "capture-review",
        capturedAt: 2,
        data: { caption: "Close", framePath: "frames/004.png" },
      },
    ],
  } as unknown as TestJob;

  assert.deepEqual(summarizeJob(job).destIdentity, [
    { path: "frames/003.png", caption: "Observe" },
  ]);
  assert.equal(summarizeJob(job).frameCount, 2);
});

test("unphased job summaries drop leftover Transition executed / Inspect setup skipped", () => {
  const job = {
    id: "unphased-transition",
    action: "observe",
    status: "ok",
    queuedAt: 10,
    platform: "browser",
    targetKind: "browser",
    logs: [],
    frames: [
      { path: "frames/002.png", caption: "after · Transition executed", capturedAt: 1 },
      { path: "frames/003.png", caption: "Observe", capturedAt: 2 },
      {
        path: "frames/004.png",
        caption: "after · Inspect setup skipped — already on this view",
        capturedAt: 3,
      },
    ],
    artifacts: [],
  } as unknown as TestJob;

  assert.deepEqual(summarizeJob(job).destIdentity, [
    { path: "frames/003.png", caption: "Observe" },
  ]);
  assert.equal(summarizeJob(job).frameCount, 3);
});

test("unphased Android dest-wait with no leftover caption omits destIdentity", () => {
  const job = {
    id: "android-r368",
    action: "observe",
    status: "ok",
    queuedAt: 10,
    platform: "android",
    targetKind: "device",
    logs: [],
    frames: [
      { path: "frames/001.png", caption: "after · Reach home", capturedAt: 1 },
      { path: "frames/002.png", caption: "Observe", capturedAt: 2 },
    ],
    artifacts: [],
  } as unknown as TestJob;

  assert.equal(summarizeJob(job).destIdentity, undefined);
  assert.equal(summarizeJob(job).frameCount, 2);
});

test("a persisted run can replay its frozen plan without consulting current authoring state", () => {
  const replay = replayInputFromPersistedRun({
    id: "run-1",
    action: "app-map:settings:flow",
    serial: "pixel-1",
    platform: "android",
    title: "Settings coverage",
    resolvedInputs: { language: "it" },
    recipeSnapshot: {
      id: "app-map:settings:flow",
      title: "Frozen settings plan",
      steps: [{ kind: "sleep", ms: 1 }],
    } as never,
    recipeGraph: {
      "app-map:settings:flow": {
        id: "app-map:settings:flow",
        title: "Frozen settings plan",
        steps: [{ kind: "sleep", ms: 1 }],
      },
    } as never,
    projectId: "project-1",
    ownerId: "human:one",
  });

  assert.equal(replay.recipe, "app-map:settings:flow");
  assert.equal(replay.serial, "pixel-1");
  assert.equal(replay.platform, "android");
  assert.deepEqual(replay.variables, { language: "it" });
  assert.equal(replay.recipeSnapshot?.title, "Frozen settings plan");
});

test("a recorded run with redacted private inputs refuses unsafe replay", () => {
  assert.throws(
    () =>
      replayInputFromPersistedRun({
        id: "run-1",
        action: "settings",
        serial: "pixel-1",
        platform: "android",
        resolvedInputs: { login_email: "[private]" },
        recipeSnapshot: { id: "settings", title: "Settings", steps: [] } as never,
        recipeGraph: { settings: { id: "settings", title: "Settings", steps: [] } } as never,
      }),
    /private value.*login_email/i,
  );
});
