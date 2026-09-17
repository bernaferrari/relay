import assert from "node:assert/strict";
import test from "node:test";
import {
  captureReviewIdentityFramePaths,
  captureReviewSlotId,
  formatCaptureReviewCoverageSummary,
} from "./capture-review.js";
import {
  resolvePlanCaptureReviewQueue,
  selectedPlanCaptureReviewItems,
} from "./capture-review-plan.js";
import {
  RC23_SCREENSHOT_FIRST_CAPTURED_PENDING,
  RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS,
  RC23_SCREENSHOT_FIRST_PLATFORMS,
  RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION,
  RC23_SCREENSHOT_FIRST_REQUIREMENT_ID,
  RC23_SCREENSHOT_FIRST_TESTS,
  materializeRc23ScreenshotFirstSlots,
  partitionRc23ScreenshotFirst,
  rc23LooksCorrectCannotAcceptMissing,
  rc23ScreenshotFirstArtifactPhase,
  rc23ScreenshotFirstProductPlanRuns,
  rc23ScreenshotFirstRuns,
  resolveRc23ScreenshotFirstQueue,
} from "./rc23-screenshot-first.js";
import {
  rc23DestEndSatisfiesOriginal,
  rc23WorkbookBindingSlotId,
  rc23WorkbookBoundOriginalIds,
  WORKBOOK_RC23_PLATFORM_CONFIGURATION,
  WORKBOOK_RC23_REQUIREMENT_ID,
} from "./workbook-coverage.js";

test("RC-23 freezes ten dest-end checkpoints × three platforms = 30 unique slots", () => {
  assert.equal(RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS.length, 10);
  assert.deepEqual(
    [...RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS],
    [
      "home-chrome",
      "dictation",
      "sidebar",
      "attach",
      "settings",
      "imagine",
      "logo",
      "composer-focus",
      "models",
      "private-chat",
    ],
  );
  const slots = materializeRc23ScreenshotFirstSlots();
  assert.equal(slots.length, 30);
  assert.equal(new Set(slots.map((slot) => captureReviewSlotId(slot))).size, 30);
  assert.equal(
    slots.every((slot) => slot.requirementId === RC23_SCREENSHOT_FIRST_REQUIREMENT_ID),
    true,
  );
  assert.equal(
    slots.every((slot) => !slot.requirementId?.startsWith("GQA-")),
    true,
  );
  assert.equal(
    slots.every((slot) => slot.attempt === 1),
    true,
  );
  assert.equal(
    RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS.every((checkpointId) =>
      RC23_SCREENSHOT_FIRST_PLATFORMS.some(
        (platform) => RC23_SCREENSHOT_FIRST_TESTS[checkpointId][platform],
      ),
    ),
    true,
  );
});

test("two Settings captions on web vs iOS are two slots", () => {
  const slots = materializeRc23ScreenshotFirstSlots().filter(
    (slot) => slot.checkpointId === "settings",
  );
  assert.equal(slots.length, 3);
  assert.equal(
    slots.every((slot) => slot.caption === "Settings"),
    true,
  );
  const web = slots.find((slot) => slot.platform === "web")!;
  const ios = slots.find((slot) => slot.platform === "ios")!;
  assert.notEqual(captureReviewSlotId(web), captureReviewSlotId(ios));
  assert.equal(web.configuration?.browser, "grok-com");
  assert.equal(ios.configuration?.app, "ai.x.GrokApp");
});

test("web home-chrome freeze job is leftover dest-phase r937, not prior r916", () => {
  const webHome = RC23_SCREENSHOT_FIRST_CAPTURED_PENDING.find(
    (item) => item.checkpointId === "home-chrome" && item.platform === "web",
  );
  assert.equal(webHome?.jobId, "4b93702b-d2cc-4db6-83ff-800380a3b284");
  assert.notEqual(webHome?.jobId, "ec2588e6-b64c-4ccd-9e5b-d5c7831b6c97");
});

test("freeze mapping stamps dest-phase on web/iOS artifacts; Android dest-wait stays unphased", () => {
  assert.equal(rc23ScreenshotFirstArtifactPhase("web"), "dest");
  assert.equal(rc23ScreenshotFirstArtifactPhase("ios"), "dest");
  assert.equal(rc23ScreenshotFirstArtifactPhase("android"), undefined);
  const slots = materializeRc23ScreenshotFirstSlots();
  assert.equal(
    slots.every((slot) => !slot.phase),
    true,
  );
  assert.equal(
    slots.every((slot) => !captureReviewSlotId(slot).endsWith("::dest")),
    true,
  );
  const runs = rc23ScreenshotFirstRuns();
  const webHome = runs.find(
    (run) =>
      run.plannedSlots[0]?.checkpointId === "home-chrome" &&
      run.plannedSlots[0]?.configuration?.browser === "grok-com",
  )!;
  const iosHome = runs.find(
    (run) =>
      run.plannedSlots[0]?.checkpointId === "home-chrome" &&
      run.plannedSlots[0]?.configuration?.app === "ai.x.GrokApp",
  )!;
  const androidHome = runs.find(
    (run) =>
      run.plannedSlots[0]?.checkpointId === "home-chrome" &&
      run.plannedSlots[0]?.configuration?.app === "android",
  )!;
  const iosImagine = runs.find(
    (run) =>
      run.plannedSlots[0]?.checkpointId === "imagine" &&
      run.plannedSlots[0]?.configuration?.app === "ai.x.GrokApp",
  )!;
  assert.deepEqual(captureReviewIdentityFramePaths(webHome.artifacts ?? []), [
    "frames/home-chrome-web.png",
  ]);
  assert.deepEqual(captureReviewIdentityFramePaths(iosHome.artifacts ?? []), [
    "frames/home-chrome-ios.png",
  ]);
  assert.deepEqual(captureReviewIdentityFramePaths(androidHome.artifacts ?? []), []);
  assert.deepEqual(captureReviewIdentityFramePaths(iosImagine.artifacts ?? []), []);
  assert.equal(
    runs
      .filter((run) => run.plannedSlots[0]?.configuration?.browser === "grok-com")
      .every((run) =>
        (run.artifacts ?? []).some((artifact) => {
          const phase = (artifact.data as { phase?: string } | undefined)?.phase;
          const policy = (artifact.data as { policy?: string } | undefined)?.policy;
          return phase === "dest" && policy === "fast";
        }),
      ),
    true,
  );
  assert.equal(
    runs
      .filter((run) => run.plannedSlots[0]?.configuration?.app === "ai.x.GrokApp")
      .filter((run) => (run.artifacts ?? []).length > 0)
      .every((run) =>
        (run.artifacts ?? []).some(
          (artifact) => (artifact.data as { phase?: string } | undefined)?.phase === "dest",
        ),
      ),
    true,
  );
  assert.equal(
    runs
      .filter((run) => run.plannedSlots[0]?.configuration?.app === "android")
      .every((run) =>
        (run.artifacts ?? []).every(
          (artifact) => (artifact.data as { phase?: string } | undefined)?.phase === undefined,
        ),
      ),
    true,
  );
  const queue = resolveRc23ScreenshotFirstQueue();
  const counts = partitionRc23ScreenshotFirst(queue);
  assert.equal(counts.planned, 30);
  assert.equal(counts.captured, 29);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.missing, 0);
  assert.equal(counts.pending, 29);
  assert.equal(counts.accepted, 0);
});

test("30 planned; 29 captured + 1 blocked + 0 missing = 30; mixed 12 is not complete", () => {
  const queue = resolveRc23ScreenshotFirstQueue();
  const counts = partitionRc23ScreenshotFirst(queue);
  assert.equal(counts.planned, 30);
  assert.equal(counts.captured, 29);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.missing, 0);
  assert.equal(counts.pending, 29);
  assert.equal(counts.accepted, 0);
  assert.equal(queue.summary.planned, 30);
  assert.equal(queue.summary.captured, 29);
  assert.equal(queue.summary.blocked, 1);
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.summary.pending, 29);
  assert.equal(queue.summary.accepted, 0);
  assert.equal(
    formatCaptureReviewCoverageSummary(queue.summary),
    "30 planned · 29 captured · 1 blocked · 0 missing · 29 pending · 0 accepted",
  );
  assert.equal(counts.captured + counts.blocked + counts.missing, 30);
  assert.notEqual(counts.captured, 12);
  assert.notEqual(counts.captured, 30);
  assert.notEqual(counts.planned, 13);
  assert.equal(RC23_SCREENSHOT_FIRST_CAPTURED_PENDING.length, 29);
});

test("iOS Imagine stays blocked Unbound in the denominator, not omitted", () => {
  const queue = resolveRc23ScreenshotFirstQueue();
  const imagine = queue.items.filter((item) => item.checkpointId === "imagine");
  assert.equal(imagine.length, 3);
  const ios = imagine.find((item) => item.configuration?.app === "ai.x.GrokApp")!;
  const web = imagine.find((item) => item.configuration?.browser === "grok-com")!;
  const android = imagine.find((item) => item.configuration?.app === "android")!;
  assert.equal(ios.status, "missing");
  assert.equal(ios.blocked, true);
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.summary.blocked, 1);
  assert.equal(web.status, "pending");
  assert.equal(web.blocked, undefined);
  assert.equal(web.scenarioKind, "browser-approximation");
  assert.equal(android.status, "pending");
  assert.equal(android.blocked, undefined);
  assert.equal(android.scenarioKind, "physical");
});

test("product persist mapping keeps Imagine blocked in the denominator, not missing", () => {
  const queue = resolvePlanCaptureReviewQueue(rc23ScreenshotFirstProductPlanRuns());
  const counts = partitionRc23ScreenshotFirst(queue);
  assert.equal(counts.planned, 30);
  assert.equal(counts.captured, 29);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.missing, 0);
  assert.equal(counts.pending, 29);
  assert.equal(counts.accepted, 0);
  assert.equal(
    formatCaptureReviewCoverageSummary(queue.summary),
    "30 planned · 29 captured · 1 blocked · 0 missing · 29 pending · 0 accepted",
  );
  const imagine = queue.items.find((item) => item.checkpointId === "imagine" && item.blocked);
  assert.ok(imagine);
  assert.ok(imagine.runId);
  assert.equal(imagine.status, "missing");
  assert.equal(
    selectedPlanCaptureReviewItems(queue, [{ runId: imagine.runId, captureId: imagine.captureId }])
      .length,
    0,
  );
});

test("Looks correct cannot accept missing, including the blocked iOS Imagine slot", () => {
  const queue = resolveRc23ScreenshotFirstQueue();
  const refusal = rc23LooksCorrectCannotAcceptMissing(queue);
  assert.equal(refusal.missingAttempted, 1);
  assert.equal(refusal.selected, 0);
  const missing = queue.items.find(
    (item) => item.checkpointId === "imagine" && item.configuration?.app === "ai.x.GrokApp",
  )!;
  assert.ok(missing.runId);
  assert.equal(missing.status, "missing");
  assert.equal(missing.blocked, true);
  assert.equal(
    selectedPlanCaptureReviewItems(queue, [{ runId: missing.runId, captureId: missing.captureId }])
      .length,
    0,
  );
  const models = queue.items.find(
    (item) => item.checkpointId === "models" && item.configuration?.browser === "grok-com",
  )!;
  assert.equal(models.status, "pending");
  const captured = queue.items.find((item) => item.status === "pending")!;
  assert.ok(captured.runId);
  assert.equal(
    selectedPlanCaptureReviewItems(queue, [
      { runId: captured.runId, captureId: captured.captureId },
    ]).length,
    1,
  );
});

test("RC-23 dest-ends bind GQA-004 and GQA-040 only; slot ids are not captions", () => {
  assert.deepEqual(rc23WorkbookBoundOriginalIds(), [4, 40]);
  assert.equal(WORKBOOK_RC23_REQUIREMENT_ID, RC23_SCREENSHOT_FIRST_REQUIREMENT_ID);
  assert.deepEqual(
    WORKBOOK_RC23_PLATFORM_CONFIGURATION,
    RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION,
  );
  const slots = materializeRc23ScreenshotFirstSlots();
  for (const platform of RC23_SCREENSHOT_FIRST_PLATFORMS) {
    const attach = slots.find(
      (slot) => slot.checkpointId === "attach" && slot.platform === platform,
    )!;
    assert.equal(attach.caption, "Attach");
    assert.equal(attach.requirementId, RC23_SCREENSHOT_FIRST_REQUIREMENT_ID);
    assert.equal(rc23WorkbookBindingSlotId("attach", platform), captureReviewSlotId(attach));
    assert.notEqual(rc23WorkbookBindingSlotId("attach", platform), attach.caption);
    assert.equal(rc23DestEndSatisfiesOriginal("attach", 4, platform), true);
    assert.equal(rc23DestEndSatisfiesOriginal("settings", 40, platform), true);
    assert.equal(rc23DestEndSatisfiesOriginal("composer-focus", 6, platform), false);
    assert.equal(rc23DestEndSatisfiesOriginal("imagine", 37, platform), false);
    assert.equal(rc23DestEndSatisfiesOriginal("models", 7, platform), false);
    assert.equal(Boolean(RC23_SCREENSHOT_FIRST_TESTS.attach[platform]), true);
    assert.equal(Boolean(RC23_SCREENSHOT_FIRST_TESTS.settings[platform]), true);
  }
  assert.equal(
    slots.every((slot) => !slot.requirementId?.startsWith("GQA-")),
    true,
  );
});
