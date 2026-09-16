import assert from "node:assert/strict";
import test from "node:test";
import { captureReviewSlotId } from "./capture-review.js";
import { selectedPlanCaptureReviewItems } from "./capture-review-plan.js";
import {
  RC23_SCREENSHOT_FIRST_CAPTURED_PENDING,
  RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS,
  RC23_SCREENSHOT_FIRST_PLATFORMS,
  RC23_SCREENSHOT_FIRST_REQUIREMENT_ID,
  RC23_SCREENSHOT_FIRST_TESTS,
  materializeRc23ScreenshotFirstSlots,
  partitionRc23ScreenshotFirst,
  rc23LooksCorrectCannotAcceptMissing,
  resolveRc23ScreenshotFirstQueue,
} from "./rc23-screenshot-first.js";

test("RC-23 freezes ten dest-end checkpoints × three platforms = 30 unique slots", () => {
  assert.equal(RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS.length, 10);
  assert.deepEqual([...RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS], [
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
  ]);
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

test("30 planned; 29 captured + 1 blocked + 0 missing = 30; mixed 12 is not complete", () => {
  const queue = resolveRc23ScreenshotFirstQueue();
  const counts = partitionRc23ScreenshotFirst(queue);
  assert.equal(counts.planned, 30);
  assert.equal(counts.captured, 29);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.missing, 0);
  assert.equal(counts.pending, 29);
  assert.equal(counts.accepted, 0);
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
  assert.equal(web.status, "pending");
  assert.equal(web.blocked, undefined);
  assert.equal(web.scenarioKind, "browser-approximation");
  assert.equal(android.status, "pending");
  assert.equal(android.blocked, undefined);
  assert.equal(android.scenarioKind, "physical");
});

test("Looks correct cannot accept missing, including the blocked iOS Imagine slot", () => {
  const queue = resolveRc23ScreenshotFirstQueue();
  const refusal = rc23LooksCorrectCannotAcceptMissing(queue);
  assert.equal(refusal.missingAttempted, 1);
  assert.equal(refusal.selected, 0);
  const missing = queue.items.find(
    (item) => item.checkpointId === "imagine" && item.configuration?.app === "ai.x.GrokApp",
  )!;
  assert.equal(missing.status, "missing");
  assert.equal(missing.blocked, true);
  assert.equal(
    selectedPlanCaptureReviewItems(queue, [
      { runId: missing.runId, captureId: missing.captureId },
    ]).length,
    0,
  );
  const models = queue.items.find(
    (item) => item.checkpointId === "models" && item.configuration?.browser === "grok-com",
  )!;
  assert.equal(models.status, "pending");
  const captured = queue.items.find((item) => item.status === "pending")!;
  assert.equal(
    selectedPlanCaptureReviewItems(queue, [
      { runId: captured.runId, captureId: captured.captureId },
    ]).length,
    1,
  );
});
