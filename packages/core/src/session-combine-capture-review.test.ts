import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  captureReviewSlotId,
  materializeCaptureReviewSlots,
  type AppMapCompiledTest,
  type CombineCampaign,
} from "@relay/protocol";
import { PNG } from "pngjs";
import { appMapCombineCellId } from "./app-map-combine-cell.js";
import {
  createAppMapCombineCellExecutionIntent,
  parseAppMapCombineCellExecutionIntentArtifact,
} from "./app-map-combine-cell-intent.js";
import { composeAppMapCombineCellWrapper } from "./app-map-combine-cell-wrapper.js";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import { captureReviewQueueForCampaign } from "./capture-review-plan.js";
import type { Device } from "./device.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import type { Recipe, RecipeStep } from "./recipes.js";
import type { TestJob } from "./session-contract.js";
import { runRecipeSteps } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

function recipe(id: string, steps: RecipeStep[]): Recipe {
  return { id, title: id, source: "custom", steps, createdAt: 1, updatedAt: 1 };
}

function screenshot(id: string): RecipeStep {
  return { id, kind: "screenshot", caption: id, review: { mode: "later" } };
}

function fixture(destEnd = false) {
  const root = recipe(
    "test-root",
    destEnd
      ? [{ kind: "module", recipeId: "leaf", check: { id: "background", title: "Background" } }]
      : [
          screenshot("before"),
          { kind: "module", recipeId: "leaf" },
          screenshot("after"),
          { kind: "module", recipeId: "leaf" },
        ],
  );
  const graph = {
    [root.id]: root,
    leaf: recipe("leaf", destEnd ? [{ kind: "key", key: "home" }] : [screenshot("nested")]),
  };
  const profile = {
    id: "android",
    targetId: "fixture-android",
    platform: "android" as const,
    capabilities: ["screenshot" as const],
  };
  const plannedSlots = materializeCaptureReviewSlots({
    recipeSteps: root.steps,
    recipes: graph,
    requirementId: "image-test",
    configuration: { app: "android" },
  });
  const plan: AppMapCompiledTest = {
    schemaVersion: 1,
    appMapId: "fixture",
    appMapRevision: 1,
    test: { id: "image-test", name: "Image test", kind: "scenario", intentSchemaVersion: 1 },
    runtimeTargetProfile: profile,
    rootRecipeId: root.id,
    recipes: Object.fromEntries(
      Object.values(graph).map(({ id, title, steps }) => [
        id,
        { id, title, steps, parameters: [] },
      ]),
    ),
    stepProvenance: [],
    performance: {
      executableOperations: 6,
      moduleCalls: 2,
      operationCounts: { screenshot: 4, module: 2 },
      screenshotCount: 4,
      destinationProofCount: 0,
    },
    plannedSlots,
    ...(destEnd ? { destEndRecipeIds: ["leaf"] } : {}),
    startup: { mode: "cold" },
  };
  const child = createAppMapTestExecutionIntent({
    plan,
    recipeGraph: graph,
    preflight: preflightCompiledAppMapTestOffline(plan),
  });
  const cellId = appMapCombineCellId(plan.test.id, {});
  const wrapper = composeAppMapCombineCellWrapper({
    cellId,
    childRootId: root.id,
    childGraph: graph,
    sets: [],
  });
  if (!destEnd) {
    wrapper.root.steps.unshift(screenshot("wrapper-setup"));
    wrapper.root.steps.push(screenshot("wrapper-restore"));
  }
  const intent = createAppMapCombineCellExecutionIntent({
    cellId,
    testId: plan.test.id,
    values: {},
    selectedRuntimeTargetProfile: profile,
    child,
    wrapperRoot: wrapper.root,
    recipeGraph: wrapper.graph,
    staticInputs: { values: {}, companions: {} },
  });
  const job = {
    id: "combine-capture-fixture",
    action: "test",
    status: "running",
    platform: "android",
    deviceName: "SM S931B",
    queuedAt: Date.now(),
    steps: [],
    artifacts: [{ kind: intent.kind, capturedAt: 1, data: intent }],
    frames: [],
    resolvedInputs: {},
    recipeId: wrapper.root.id,
    recipeSnapshot: wrapper.root,
    recipeGraph: wrapper.graph,
  } as unknown as TestJob;
  return { job, intent, plannedSlots };
}

async function execute(job: TestJob, native = false): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-capture-executor-"));
  const previous = {
    runs: process.env.RELAY_RUNS_DIR,
    automatic: process.env.RELAY_AUTO_VISUAL_EVIDENCE,
  };
  process.env.RELAY_RUNS_DIR = directory;
  process.env.RELAY_AUTO_VISUAL_EVIDENCE = "0";
  const png = PNG.sync.write(new PNG({ width: 32, height: 32 }));
  let homeCalls = 0;
  const device = {
    command: {
      home: async () => {
        homeCalls += 1;
        return {};
      },
    },
    capture: {
      screenshot: async ({ path }: { path: string }) => {
        await writeFile(path, png);
        return {};
      },
    },
  } as unknown as Device;
  try {
    // A supplied Device exercises the screenshot transport without opening a
    // browser or touching Android. The job retains its actual Android metadata.
    await runWithTargetContext(
      native
        ? { kind: "device", platform: "android", serial: "fixture" }
        : { kind: "browser", platform: "browser", targetId: "fixture" },
      () =>
        runRecipeSteps(
          job,
          device,
          () => {},
          () => {},
        ),
    );
    job.status = "ok";
    return homeCalls;
  } finally {
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.automatic === undefined) delete process.env.RELAY_AUTO_VISUAL_EVIDENCE;
    else process.env.RELAY_AUTO_VISUAL_EVIDENCE = previous.automatic;
    await rm(directory, { recursive: true, force: true });
  }
}

test("Combine execution captures the frozen child slots and retains nested invocation counts", async () => {
  const { job, intent, plannedSlots } = fixture();
  const frozenSlots = structuredClone(plannedSlots);
  await execute(job);
  const reviews = job.artifacts
    .filter((artifact) => artifact.kind === "capture-review")
    .map((artifact) => artifact.data as Record<string, unknown>);
  assert.equal(reviews.length, 6);
  const childReviews = reviews.filter(
    (review) => !String(review.checkpointId).startsWith("wrapper-"),
  );
  assert.deepEqual(
    childReviews.map((review) => review.slotId),
    plannedSlots.map(captureReviewSlotId),
  );
  assert.deepEqual(
    childReviews.map((review) => review.invocation),
    [undefined, "module:leaf#0", undefined, "module:leaf#1"],
  );
  for (const review of childReviews) {
    assert.equal(review.requirementId, "image-test");
    assert.deepEqual(review.configuration, { app: "android" });
    assert.equal(review.status, "pending");
    assert.equal(typeof review.framePath, "string");
  }
  for (const review of reviews.filter((review) =>
    String(review.checkpointId).startsWith("wrapper-"),
  )) {
    assert.equal(review.requirementId, undefined);
    assert.deepEqual(review.configuration, { app: "SM S931B" });
  }
  const campaign = {
    id: "campaign",
    execution: { selectedCellIds: [intent.cell.cellId], seed: 1 },
    cases: [
      {
        index: 0,
        cellId: intent.cell.cellId,
        testId: intent.cell.testId,
        values: {},
        phase: "coverage",
        status: "passed",
        runId: job.id,
        plannedCaptures: frozenSlots,
      },
    ],
  } as unknown as CombineCampaign;
  const queue = captureReviewQueueForCampaign(campaign, [job]);
  assert.equal(queue.summary.planned, 4);
  assert.equal(queue.summary.captured, 4);
  assert.equal(queue.summary.missing, 0);
  assert.deepEqual(intent.child.plan.plannedSlots, frozenSlots);
  assert.ok(parseAppMapCombineCellExecutionIntentArtifact(job.artifacts[0]));
});

test("Combine recaptures retain attempt identity without changing the canonical child obligations", async () => {
  const { job, intent, plannedSlots } = fixture();
  await execute(job);
  await execute(job);
  const childReviews = job.artifacts
    .filter((artifact) => artifact.kind === "capture-review")
    .map((artifact) => artifact.data as Record<string, unknown>)
    .filter((review) => review.requirementId === "image-test");
  assert.deepEqual(
    childReviews.map((review) => review.attempt),
    [1, 1, 1, 1, 2, 2, 2, 2],
  );
  assert.deepEqual(
    childReviews.map((review) => review.invocation),
    [
      undefined,
      "module:leaf#0",
      undefined,
      "module:leaf#1",
      undefined,
      "module:leaf#0",
      undefined,
      "module:leaf#1",
    ],
  );
  assert.deepEqual(intent.child.plan.plannedSlots, plannedSlots);
  assert.ok(parseAppMapCombineCellExecutionIntentArtifact(job.artifacts[0]));
});

test("malformed Combine intent cannot provide a partial child capture identity", async () => {
  const { job, intent } = fixture();
  intent.digest = "0".repeat(64);
  await execute(job);
  const reviews = job.artifacts
    .filter((artifact) => artifact.kind === "capture-review")
    .map((artifact) => artifact.data as Record<string, unknown>);
  assert.ok(reviews.every((review) => review.requirementId === undefined));
  assert.ok(
    reviews.every((review) => (review.configuration as { app?: string })?.app === "SM S931B"),
  );
  assert.equal(
    reviews.find((review) => review.checkpointId === "before")?.invocation,
    "module:test-root#0",
  );
});

test("Combine execution seeds dest-end permissions only from its canonical child plan", async () => {
  const { job } = fixture(true);
  assert.equal(await execute(job, true), 1);
  assert.equal(
    job.artifacts.some((artifact) => artifact.kind === "campaign-effect-blocked"),
    false,
  );
  const check = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
  assert.equal((check?.data as { status?: string })?.status, "passed");
});
