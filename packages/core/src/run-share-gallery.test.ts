import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AppMapCompiledTest,
  CaptureReviewPlannedSlot,
  CombineCampaign,
} from "@relay/protocol";
import { captureReviewSlotId } from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import type { Recipe } from "./recipes.js";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import { freezeRunShareCaptureScope } from "./run-share-gallery.js";
import {
  buildRunShareReport,
  createRunShare,
  resolveRunShareToken,
  type RunShareRecord,
} from "./run-shares.js";
import { createCombineCampaign } from "./combine-campaign.js";

function slots(locale: string): CaptureReviewPlannedSlot[] {
  return ["Home", "Settings", "Billing"].map((caption) => ({
    checkpointId: caption.toLowerCase(),
    stepId: caption.toLowerCase(),
    caption,
    configuration: { locale },
    attempt: 1,
  }));
}

function intent(plannedSlots: CaptureReviewPlannedSlot[], testId = "settings", revision = 7) {
  const recipe: Recipe = {
    id: `${testId}:root`,
    title: "Settings",
    source: "custom",
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const plan: AppMapCompiledTest = {
    schemaVersion: 1,
    appMapId: "app",
    appMapRevision: 7,
    test: { id: testId, name: "Settings", kind: "scenario", intentSchemaVersion: 1 },
    testFamily: {
      schemaVersion: 1,
      mode: "legacy-single-surface",
      testRevision: revision,
      logicalIntentRevision: 1,
      bindingRevision: 1,
      logicalStateBindings: [],
      actionIntentBindings: [],
    },
    plannedSlots,
    rootRecipeId: recipe.id,
    recipes: { [recipe.id]: { id: recipe.id, title: recipe.title, parameters: [], steps: [] } },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  };
  return createAppMapTestExecutionIntent({
    plan,
    recipeGraph: { [recipe.id]: recipe },
    preflight: preflightCompiledAppMapTestOffline(plan),
  });
}

function capturedRun(
  id: string,
  planned: CaptureReviewPlannedSlot[],
  captures: CaptureReviewPlannedSlot[],
  testId = "settings",
  revision = 7,
): PersistedRun {
  const frozen = intent(planned, testId, revision);
  return {
    schemaVersion: 5,
    id,
    projectId: "project",
    ownerId: "owner",
    batchId: "batch",
    action: "settings",
    title: id,
    status: "ok",
    outcome: "passed",
    attempts: 1,
    queuedAt: 1,
    logs: [],
    steps: [],
    dir: `/runs/${id}`,
    writtenAt: 2,
    inputDigest: "private",
    resolvedInputs: {},
    frames: captures.map((slot, index) => ({
      path: `frames/${index}.png`,
      caption: slot.caption,
      capturedAt: index + 1,
      mime: "image/png",
    })),
    artifacts: [
      { kind: frozen.kind, capturedAt: 1, data: frozen },
      ...captures.map((slot, index) => ({
        kind: "capture-review",
        capturedAt: index + 1,
        data: { ...slot, framePath: `frames/${index}.png`, imageSha256: String(index).repeat(64) },
      })),
    ],
  };
}

function campaign(runIds: Array<string | undefined>): CombineCampaign {
  return {
    schemaVersion: 1,
    id: "batch",
    projectId: "project",
    ownerId: "owner",
    appMapId: "app",
    combineId: "locales",
    sourceRevision: 7,
    latestRevision: 7,
    status: "completed-with-problems",
    createdAt: 1,
    updatedAt: 2,
    lineage: [],
    execution: { selectedCellIds: ["en", "ar", "fr"], seed: 1 },
    cases: ["en", "ar", "fr"].map((locale, index) => ({
      index,
      cellId: locale,
      testId: "settings",
      world: locale,
      values: {},
      targetProfileId: locale,
      plannedCaptures: slots(locale),
      childIntentDigest: "private",
      outerIntentDigest: "private",
      wrapperGraphDigest: "private",
      staticInputDigest: "private",
      phase: "coverage",
      status: "blocked",
      ...(runIds[index] ? { runId: runIds[index] } : {}),
    })),
  };
}

function record(runs: PersistedRun[]): RunShareRecord {
  return {
    schemaVersion: 1,
    id: "share",
    runId: runs[0]!.id,
    runIds: runs.map((run) => run.id),
    projectId: "project",
    ownerId: "owner",
    batchId: "batch",
    title: "Locales",
    createdAt: 1,
    expiresAt: 10_000,
    createdBy: "reviewer",
    frameCount: 0,
  };
}

test("missing middle and an entirely unavailable configuration retain frozen checkpoint tiles", () => {
  const english = capturedRun("english", slots("en"), slots("en"));
  const arabic = capturedRun("arabic", slots("ar"), [slots("ar")[0]!, slots("ar")[2]!]);
  const runs = [english, arabic];
  const scope = freezeRunShareCaptureScope(campaign(["english", "arabic"]), runs, 500);
  const report = buildRunShareReport({ ...record(runs), captureScope: scope }, runs);
  assert.deepEqual(
    report.gallery?.map((group) => ({ caption: group.caption, tiles: group.tiles })),
    [
      {
        caption: "Home",
        tiles: [
          { label: "en", runId: "english", frameIndex: 0 },
          { label: "ar", runId: "arabic", frameIndex: 0 },
          { label: "fr" },
        ],
      },
      {
        caption: "Settings",
        tiles: [
          { label: "en", runId: "english", frameIndex: 1 },
          { label: "ar", runId: "arabic" },
          { label: "fr" },
        ],
      },
      {
        caption: "Billing",
        tiles: [
          { label: "en", runId: "english", frameIndex: 2 },
          { label: "ar", runId: "arabic", frameIndex: 1 },
          { label: "fr" },
        ],
      },
    ],
  );
  assert.deepEqual(report.totals, {
    runs: 2,
    passed: 2,
    problems: 0,
    screenshots: 5,
    inProgress: 0,
  });
  // Gallery gaps never manufacture a failed execution verdict.
  assert.equal(report.runs[1]?.outcome, "passed");
  assert.deepEqual(report.captureReview, {
    captured: 5,
    missing: 4,
    pending: 5,
    accepted: 0,
    issue: 0,
    needMoreEvidence: 0,
  });
});

test("duplicate captions, iterations, phases and recapture attempts do not collapse", () => {
  const planned: CaptureReviewPlannedSlot[] = [
    { checkpointId: "settings-before", caption: "Settings", attempt: 1 },
    { checkpointId: "settings-after", caption: "Settings", attempt: 1 },
    {
      checkpointId: "settings-before",
      caption: "Settings",
      iteration: 0,
      invocation: "repeat:settings",
      attempt: 1,
    },
    {
      checkpointId: "settings-before",
      caption: "Settings",
      iteration: 1,
      invocation: "repeat:settings",
      attempt: 1,
    },
    { checkpointId: "settings-before", caption: "Settings", phase: "stable", attempt: 1 },
    { checkpointId: "settings-before", caption: "Settings", attempt: 2 },
  ];
  const english = capturedRun("english", planned, planned.slice(0, 5));
  const arabic = capturedRun("arabic", planned, [planned[0]!, planned[5]!]);
  const report = buildRunShareReport(record([english, arabic]), [english, arabic]);
  assert.equal(report.gallery?.length, 6);
  const retry = report.gallery?.find((group) => group.attempt === 2);
  assert.deepEqual(retry?.tiles, [
    { label: "english", runId: "english" },
    { label: "arabic", runId: "arabic", frameIndex: 1 },
  ]);
  assert.deepEqual(
    report.gallery
      ?.filter((group) => group.iteration !== undefined)
      .map((group) => group.iteration),
    [0, 1],
  );
  assert.equal(report.gallery?.filter((group) => group.phase === "stable").length, 1);
  assert.equal(report.gallery?.[0]?.tiles[1]?.frameIndex, 0);
  assert.equal(report.gallery?.[1]?.tiles[1]?.frameIndex, undefined);
});

test("observed dest metadata does not split an authoritative unphased frozen slot", () => {
  const planned = slots("en");
  const english = capturedRun("english", planned, planned);
  english.artifacts = english.artifacts.map((artifact, index) =>
    artifact.kind === "capture-review"
      ? {
          ...artifact,
          data: {
            ...(artifact.data as object),
            phase: "dest",
            slotId: captureReviewSlotId(planned[index - 1]!),
          },
        }
      : artifact,
  );
  const scope = freezeRunShareCaptureScope(campaign(["english"]), [english], 500);
  const report = buildRunShareReport({ ...record([english]), captureScope: scope }, [english]);
  assert.equal(report.gallery?.length, 3);
  assert.deepEqual(
    report.gallery?.map((group) => group.tiles.length),
    [3, 3, 3],
  );
  assert.deepEqual(
    report.gallery?.map((group) => group.phase),
    [undefined, undefined, undefined],
  );
  assert.equal(report.captureReview?.captured, 3);
  assert.equal(report.captureReview?.missing, 6);
});

test("unrelated Tests and different frozen Test revisions stay separate", () => {
  const sameCaption = [{ checkpointId: "settings", caption: "Settings", attempt: 1 }];
  const first = capturedRun("first", sameCaption, sameCaption);
  const unrelated = capturedRun("unrelated", sameCaption, sameCaption, "billing");
  const changed = capturedRun("changed", sameCaption, sameCaption, "settings", 8);
  const report = buildRunShareReport(record([first, unrelated, changed]), [
    first,
    unrelated,
    changed,
  ]);
  assert.equal(report.gallery?.length, 3);
  assert.deepEqual(
    report.gallery?.map((group) => group.tiles.length),
    [1, 1, 1],
  );
});

test("legacy correspondence requires the entire frozen recipe graph, including module bodies", () => {
  const planned = [{ checkpointId: "shared", caption: "Shared", attempt: 1 }];
  const legacyRun = (id: string, sleepMs: number) => {
    const run = capturedRun(id, planned, planned);
    const original = run.artifacts[0]!.data as ReturnType<typeof createAppMapTestExecutionIntent>;
    const plan = structuredClone(original.plan);
    delete plan.testFamily;
    const graph = structuredClone(original.recipeGraph);
    graph[plan.rootRecipeId]!.steps = [{ kind: "module", recipeId: "child" }];
    graph.child = {
      id: "child",
      title: "Child",
      source: "custom",
      steps: [{ kind: "sleep", ms: sleepMs }],
      createdAt: 1,
      updatedAt: 1,
    };
    plan.recipes[plan.rootRecipeId]!.steps = graph[plan.rootRecipeId]!.steps;
    plan.recipes.child = { id: "child", title: "Child", parameters: [], steps: graph.child.steps };
    const frozen = createAppMapTestExecutionIntent({
      plan,
      recipeGraph: graph,
      preflight: preflightCompiledAppMapTestOffline(plan),
    });
    run.artifacts[0] = { kind: frozen.kind, capturedAt: 1, data: frozen };
    return { run, frozen };
  };
  const first = legacyRun("first", 100);
  const second = legacyRun("second", 200);
  assert.equal(first.frozen.sourcePlan.rootRecipeDigest, second.frozen.sourcePlan.rootRecipeDigest);
  assert.notEqual(
    first.frozen.sourcePlan.recipeGraphDigest,
    second.frozen.sourcePlan.recipeGraphDigest,
  );
  const report = buildRunShareReport(record([first.run, second.run]), [first.run, second.run]);
  assert.equal(report.gallery?.length, 2);
  assert.deepEqual(
    report.gallery?.map((group) => group.tiles.length),
    [1, 1],
  );
});

test("a Run retry keeps the earlier capture and labels its explicit lineage", () => {
  const planned = slots("en");
  const earlier = { ...capturedRun("earlier", planned, planned), retriedBy: "retry" };
  const retry = { ...capturedRun("retry", planned, planned), retryOf: "earlier" };
  const runs = [earlier, retry];
  const report = buildRunShareReport(record(runs), runs);
  assert.equal(report.gallery?.length, 3);
  assert.deepEqual(report.gallery?.[1]?.tiles, [
    { label: "en · Earlier run", runId: "earlier", frameIndex: 1 },
    { label: "en · Retry", runId: "retry", frameIndex: 1 },
  ]);
  assert.equal(report.totals.screenshots, 6);
});

test("share creation freezes selected missing cases and does not follow later campaign retries", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-share-scope-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const english = capturedRun("english", slots("en"), slots("en"));
  try {
    const frozenCampaign = campaign(["english"]);
    await createCombineCampaign({ ...frozenCampaign, execution: frozenCampaign.execution! });
    const share = await createRunShare({
      root,
      run: english,
      relatedRuns: [english],
      actorId: "reviewer",
      expiresAt: 3_600_001,
      includeBatch: true,
      at: 1,
    });
    const frozen = await resolveRunShareToken(root, share.token, 2);
    assert.equal(frozen?.captureScope?.length, 3);
    assert.ok(frozen);
    frozenCampaign.cases[1]!.runId = "later-arabic";
    const later = capturedRun("later-arabic", slots("ar"), slots("ar"));
    const report = buildRunShareReport(frozen, [english, later]);
    assert.deepEqual(
      report.gallery?.[1]?.tiles.map((tile) => tile.frameIndex),
      [1, undefined, undefined],
    );
    assert.deepEqual(
      report.runs.map((run) => run.id),
      ["english"],
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
