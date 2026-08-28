import assert from "node:assert/strict";
import test from "node:test";
import { replayInputFromPersistedRun, summarizeJob, type TestJob } from "./session.js";

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
