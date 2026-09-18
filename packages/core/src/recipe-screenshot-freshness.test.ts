import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTURE_REVIEW_DEST_PHASE,
  CAPTURE_REVIEW_LEFTOVER_PHASE,
  captureReviewSlotId,
  resolveCaptureReviewQueue,
} from "@relay/protocol";
import type { Device } from "./device.js";
import { captureRecipeScreenshot, runExpectScreenStep } from "./recipe-runner-screen.js";
import { runWithTargetContext } from "./target-context.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

function frame(text: string): ScreenshotPayload {
  return {
    capturedAt: Date.now(),
    mime: "image/png",
    base64: Buffer.from(text).toString("base64"),
    path: "/tmp/fixture.png",
    bytes: text.length,
  };
}

test("explicit screenshot ignores cached pixels and takes one unmeasured Fast frame", async () => {
  const observation = {
    observedAt: 1,
    nodes: [{ role: "heading", label: "Destination" }],
    screenshot: frame("old"),
  };
  let captures = 0;
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "After tap",
      { runtime: { observation }, artifacts, log: () => {} },
      {
        captureScreenshot: async (options) => {
          assert.equal(options?.ephemeral, true);
          return frame(++captures === 1 ? "transition" : "destination");
        },
      },
    ),
  );
  assert.equal(captures, 1);
  assert.equal(observation.screenshot.base64, frame("transition").base64);
  assert.deepEqual(
    artifacts.map((item) => [
      item.kind,
      (item.data as { settled: boolean; stabilityMeasured?: boolean; policy?: string }).settled,
      (item.data as { stabilityMeasured?: boolean }).stabilityMeasured,
      (item.data as { policy?: string }).policy,
    ]),
    [["visual-settling", false, false, "fast"]],
  );
});

test("capture-for-review records a pending human-review artifact without a judge", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Arabic account settings",
      { artifacts, log: () => {} },
      { captureScreenshot: async () => ({ ...frame("arabic"), framePath: "frames/001.png" }) },
      { review: { mode: "later", lookFor: "Save is visible" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review");
  assert.ok(review);
  assert.equal((review?.data as { status?: string }).status, "pending");
  assert.equal((review?.data as { caption?: string }).caption, "Arabic account settings");
  assert.equal((review?.data as { lookFor?: string }).lookFor, "Save is visible");
  assert.equal(typeof (review?.data as { imageSha256?: string }).imageSha256, "string");
});

test("capture-for-review records the observed account, viewport, and locale", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "seeded-member-app" },
    () =>
      captureRecipeScreenshot(
        device,
        "Member · Compact · Arabic",
        {
          artifacts,
          log: () => {},
          job: {
            resolvedInputs: { account: "Member" },
            browserTargetId: "seeded-member-app",
            browserCaseProfile: {
              engine: "chromium",
              locale: "ar",
              viewport: { width: 390, height: 844 },
            },
          } as never,
        },
        { captureScreenshot: async () => ({ ...frame("arabic"), framePath: "frames/001.png" }) },
        { review: { mode: "later", lookFor: "Save is visible" } },
      ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review");
  assert.deepEqual((review?.data as { configuration?: unknown }).configuration, {
    app: "seeded-member-app",
    account: "Member",
    browser: "chromium",
    viewport: "390×844",
    locale: "ar",
  });
});

const labFixture = "authfx:7189423f-193e-45ed-b674-154505cc5107:1";

test("unsigned grok-daily capture stays signed-out even when overlay says SuperGrok", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    captureRecipeScreenshot(
      device,
      "Home",
      {
        artifacts,
        log: () => {},
        job: {
          unsignedLaneId: "grok-daily",
          resolvedInputs: { account: "SuperGrok" },
          browserTargetId: "grok-com",
          targetProfile: { id: "browser:grok-com" },
          browserCaseProfile: { engine: "chromium" },
        } as never,
      },
      { captureScreenshot: async () => ({ ...frame("daily"), framePath: "frames/daily.png" }) },
      { review: { mode: "later", checkpointId: "home" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    configuration?: { account?: string };
    observed?: { laneId?: string; profileId?: string; sessionStore?: string };
    slotId?: string;
  };
  assert.equal(review.configuration?.account, "signed-out");
  assert.equal(review.observed?.laneId, "grok-daily");
  assert.equal(review.observed?.profileId, "browser:grok-com");
  assert.equal(review.observed?.sessionStore, "playwright-user-data");
  assert.doesNotMatch(review.slotId ?? "", /grok-daily/u);
  assert.doesNotMatch(review.slotId ?? "", /SuperGrok/u);
});

test("Lane name grok-lab without a fixture is not SuperGrok", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    captureRecipeScreenshot(
      device,
      "Home",
      {
        artifacts,
        log: () => {},
        job: {
          unsignedLaneId: "grok-lab",
          resolvedInputs: { account: "SuperGrok" },
          browserTargetId: "grok-com",
          targetProfile: { id: "browser:grok-com" },
          browserCaseProfile: { engine: "chromium" },
        } as never,
      },
      { captureScreenshot: async () => ({ ...frame("named"), framePath: "frames/named.png" }) },
      { review: { mode: "later", checkpointId: "home" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    configuration?: { account?: string };
    observed?: { laneId?: string };
  };
  assert.equal(review.configuration?.account, "signed-out");
  assert.equal(review.observed?.laneId, "grok-lab");
});

test("grok-lab fixture capture keeps the fixture identity, not a daily overlay", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    captureRecipeScreenshot(
      device,
      "Home",
      {
        artifacts,
        log: () => {},
        job: {
          laneId: "grok-lab",
          resolvedInputs: { account: "signed-out" },
          browserTargetId: "grok-com",
          targetProfile: { id: "browser:grok-com-1280x800-339a5a430a41" },
          browserCaseProfile: {
            engine: "chromium",
            authenticationFixtureId: labFixture,
          },
        } as never,
      },
      { captureScreenshot: async () => ({ ...frame("lab"), framePath: "frames/lab.png" }) },
      { review: { mode: "later", checkpointId: "home" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    configuration?: { account?: string };
    observed?: { laneId?: string; profileId?: string; sessionStore?: string };
    slotId?: string;
  };
  assert.equal(review.configuration?.account, labFixture);
  assert.equal(review.observed?.laneId, "grok-lab");
  assert.equal(review.observed?.profileId, "browser:grok-com-1280x800-339a5a430a41");
  assert.equal(review.observed?.sessionStore, "playwright-user-data");
  assert.notEqual(review.observed?.laneId, "grok-daily");
  assert.doesNotMatch(review.slotId ?? "", /browser:grok-com-1280x800/u);
});

test("capture-review stamps live page identity, not SuperGrok or the fixture id", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    captureRecipeScreenshot(
      device,
      "Home",
      {
        artifacts,
        log: () => {},
        job: {
          laneId: "grok-lab",
          resolvedInputs: { account: "SuperGrok" },
          browserTargetId: "grok-com",
          targetProfile: { id: "browser:grok-com-1280x800-339a5a430a41" },
          browserCaseProfile: {
            engine: "chromium",
            authenticationFixtureId: labFixture,
          },
          authenticationHealth: {
            status: "ready",
            checkedAt: 1,
            signedIn: true,
            identity: "Bernardo Ferrari",
            detail: "Signed in as Bernardo Ferrari.",
          },
        } as never,
      },
      { captureScreenshot: async () => ({ ...frame("named"), framePath: "frames/named.png" }) },
      { review: { mode: "later", checkpointId: "home" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    configuration?: { account?: string };
    observed?: { laneId?: string };
  };
  assert.equal(review.configuration?.account, "Bernardo Ferrari");
  assert.notEqual(review.configuration?.account, "SuperGrok");
  assert.notEqual(review.configuration?.account, labFixture);
  assert.equal(review.observed?.laneId, "grok-lab");
});

test("iOS leftover capture-review stamps BF identity, not signed-out grok-ios-daily", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5" },
    () =>
      captureRecipeScreenshot(
        device,
        "Home chrome",
        {
          artifacts,
          log: () => {},
          runtime: {
            observation: {
              observedAt: 1,
              nodes: [
                { role: "button", label: "BF" },
                { role: "text", label: "Bernardo Ferrari" },
                { role: "button", label: "Speak" },
              ],
            },
          },
          job: {
            laneId: "grok-ios-daily",
            unsignedLaneId: "grok-ios-daily",
            targetKind: "device",
            platform: "ios",
            serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
            deviceName: "iPad Pro 10.5",
            resolvedInputs: { account: "SuperGrok" },
            targetProfile: { id: "device:db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5" },
          } as never,
        },
        { captureScreenshot: async () => ({ ...frame("ipad"), framePath: "frames/ipad.png" }) },
        { review: { mode: "later", checkpointId: "home-chrome" } },
      ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    configuration?: { account?: string; app?: string };
    observed?: { laneId?: string; iosHardwareClass?: string; profileId?: string };
  };
  assert.equal(review.configuration?.account, "Bernardo Ferrari");
  assert.notEqual(review.configuration?.account, "signed-out");
  assert.notEqual(review.configuration?.account, "SuperGrok");
  assert.notEqual(review.configuration?.account, "grok-ios-daily");
  assert.equal(review.observed?.laneId, "grok-ios-daily");
  assert.equal(review.configuration?.app, "iPad Pro 10.5");
  assert.equal(review.observed?.iosHardwareClass, "physical-ipad");
});

test("expired fixture capture-review is blocked, not SuperGrok", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    captureRecipeScreenshot(
      device,
      "Home",
      {
        artifacts,
        log: () => {},
        job: {
          laneId: "grok-lab",
          resolvedInputs: { account: "SuperGrok" },
          browserTargetId: "grok-com",
          targetProfile: { id: "browser:grok-com-1280x800-339a5a430a41" },
          browserCaseProfile: {
            engine: "chromium",
            authenticationFixtureId: labFixture,
          },
          authenticationHealth: {
            status: "expired",
            checkedAt: 1,
            detail: "SuperGrok lab signed-in expired.",
          },
        } as never,
      },
      { captureScreenshot: async () => ({ ...frame("expired"), framePath: "frames/expired.png" }) },
      { review: { mode: "later", checkpointId: "home" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    configuration?: { account?: string };
    observed?: { laneId?: string };
  };
  assert.equal(review.configuration?.account, "blocked");
  assert.notEqual(review.configuration?.account, "SuperGrok");
  assert.notEqual(review.configuration?.account, labFixture);
  assert.equal(review.observed?.laneId, "grok-lab");
});

test("Combine-cell child laneId stamps capture observed when the job omitted it", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [
    {
      kind: "app-map-combine-cell-execution-intent",
      capturedAt: 1,
      data: { child: { laneId: "grok-lab" } },
    },
  ];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    captureRecipeScreenshot(
      device,
      "Home",
      {
        artifacts,
        log: () => {},
        job: {
          browserTargetId: "grok-com",
          targetProfile: { id: "browser:grok-com-1280x800-339a5a430a41" },
          browserCaseProfile: { engine: "chromium" },
          artifacts,
        } as never,
      },
      { captureScreenshot: async () => ({ ...frame("child"), framePath: "frames/child.png" }) },
      { review: { mode: "later", checkpointId: "home" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    observed?: { laneId?: string };
  };
  assert.equal(review.observed?.laneId, "grok-lab");
});

test("fast review capture takes one image and leaves stability unmeasured", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  let captures = 0;
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Settings",
      { artifacts, log: () => {} },
      {
        captureScreenshot: async () => {
          captures += 1;
          return { ...frame("now"), framePath: "frames/001.png" };
        },
      },
      { review: { mode: "later", policy: "fast" } },
    ),
  );
  assert.equal(captures, 1);
  const settling = artifacts.find((item) => item.kind === "visual-settling");
  assert.ok(settling);
  const data = settling.data as {
    settled?: boolean;
    samples?: number;
    stabilityMeasured?: boolean;
  };
  assert.deepEqual([data.settled, data.samples, data.stabilityMeasured], [false, 1, false]);
});

test("review capture without policy is Fast and does not wait for matching screenshots", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  let captures = 0;
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Settings",
      { artifacts, log: () => {} },
      {
        captureScreenshot: async () => {
          captures += 1;
          return { ...frame(String(captures)), framePath: "frames/001.png" };
        },
      },
      { review: { mode: "later", lookFor: "Account section" }, stepId: "settings-dest" },
    ),
  );
  assert.equal(captures, 1);
  const settling = artifacts.find((item) => item.kind === "visual-settling")?.data as {
    settled?: boolean;
    samples?: number;
    stabilityMeasured?: boolean;
    policy?: string;
  };
  const review = artifacts.find((item) => item.kind === "capture-review")?.data as {
    settled?: boolean;
    samples?: number;
    stabilityMeasured?: boolean;
    policy?: string;
  };
  assert.ok(settling);
  assert.ok(review);
  assert.deepEqual(
    [settling.settled, settling.samples, settling.stabilityMeasured, settling.policy],
    [false, 1, false, "fast"],
  );
  assert.deepEqual(
    [review.settled, review.samples, review.stabilityMeasured, review.policy],
    [false, 1, false, "fast"],
  );
});

test("sequence records the current named phase as one unmeasured image", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  let captures = 0;
  const review = {
    mode: "later" as const,
    policy: "sequence" as const,
    phases: [
      { id: "before", caption: "Before airplane" },
      { id: "during", caption: "During airplane", intervalMs: 60_000 },
    ],
  };
  const planned = [
    {
      requirementId: "GQA-016",
      checkpointId: "interrupt",
      phase: "before",
      attempt: 1,
      caption: "Before airplane",
      stepId: "interrupt",
    },
    {
      requirementId: "GQA-016",
      checkpointId: "interrupt",
      phase: "during",
      attempt: 1,
      caption: "During airplane",
      stepId: "interrupt",
      intervalMs: 60_000,
    },
  ];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Survival",
      {
        artifacts,
        log: () => {},
        captureReview: { requirementId: "GQA-016", moduleCalls: new Map() },
        plannedSlots: [...planned],
      },
      {
        captureScreenshot: async () => {
          captures += 1;
          return { ...frame("before"), framePath: "frames/001.png" };
        },
      },
      { review, stepId: "interrupt" },
    ),
  );
  assert.equal(captures, 1);
  const settling = artifacts.find((item) => item.kind === "visual-settling");
  const settlingData = settling?.data as {
    settled?: boolean;
    samples?: number;
    stabilityMeasured?: boolean;
    policy?: string;
    phase?: string;
  };
  assert.deepEqual(
    [
      settlingData.settled,
      settlingData.samples,
      settlingData.stabilityMeasured,
      settlingData.policy,
      settlingData.phase,
    ],
    [false, 1, false, "sequence", "before"],
  );
  const reviewArtifact = artifacts.find((item) => item.kind === "capture-review");
  const reviewData = reviewArtifact?.data as { phase?: string; caption?: string; slotId?: string };
  assert.equal(reviewData.phase, "before");
  assert.equal(reviewData.caption, "Before airplane");
  assert.equal(
    reviewData.slotId,
    captureReviewSlotId({
      requirementId: "GQA-016",
      checkpointId: "interrupt",
      phase: "before",
      attempt: 1,
    }),
  );
  const queue = resolveCaptureReviewQueue({
    plannedSlots: planned,
    artifacts,
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.items.find((item) => item.phase === "during")?.status, "missing");
});

test("live-output cannot treat a loading placeholder as the Sequence after phase", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  await assert.rejects(
    () =>
      runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
        captureRecipeScreenshot(
          device,
          "Final response",
          { artifacts: [], log: () => {} },
          { captureScreenshot: async () => ({ ...frame("working"), framePath: "frames/001.png" }) },
          {
            review: {
              mode: "later",
              policy: "sequence",
              phase: "after",
              lookFor: "Working for 1s",
              phases: [{ id: "after", caption: "Working", lookFor: "Working for 1s" }],
            },
          },
        ),
      ),
    /loading placeholder/u,
  );
});

test("capture-for-review stamps slot identity instead of binding by caption", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const slot = {
    requirementId: "review-settings",
    checkpointId: "settings-before-language",
    invocation: "module:settings-inventory#0",
    iteration: 0,
  };
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Settings",
      {
        artifacts,
        log: () => {},
        captureReview: { ...slot, moduleCalls: new Map() },
      },
      { captureScreenshot: async () => ({ ...frame("before"), framePath: "frames/001.png" }) },
      { review: { mode: "later", lookFor: "English section list" }, stepId: slot.checkpointId },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review");
  const data = review?.data as {
    caption?: string;
    slotId?: string;
    checkpointId?: string;
    invocation?: string;
    iteration?: number;
    attempt?: number;
    requirementId?: string;
  };
  assert.equal(data.caption, "Settings");
  assert.equal(data.checkpointId, slot.checkpointId);
  assert.equal(data.requirementId, slot.requirementId);
  assert.equal(data.invocation, slot.invocation);
  assert.equal(data.iteration, slot.iteration);
  assert.equal(data.attempt, 1);
  assert.equal(data.slotId, captureReviewSlotId({ ...slot, attempt: 1 }));
});

test("a second capture of the same checkpoint occupies attempt 2", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const slot = {
    requirementId: "review-settings",
    checkpointId: "settings",
    invocation: "module:settings-inventory#0",
    iteration: 0,
  };
  const planned = [
    {
      ...slot,
      attempt: 1,
      caption: "Settings",
      configuration: { browser: "chromium" },
      lookFor: "Account section",
      stepId: "settings",
    },
  ];
  const ctx = {
    artifacts,
    log: () => {},
    captureReview: { ...slot, moduleCalls: new Map() },
    plannedSlots: [...planned],
  };
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Settings",
      ctx,
      { captureScreenshot: async () => ({ ...frame("first"), framePath: "frames/001.png" }) },
      { review: { mode: "later", lookFor: "Account section" }, stepId: slot.checkpointId },
    ),
  );
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Settings",
      ctx,
      { captureScreenshot: async () => ({ ...frame("first"), framePath: "frames/002.png" }) },
      { review: { mode: "later", lookFor: "Account section" }, stepId: slot.checkpointId },
    ),
  );
  const reviews = artifacts.filter((item) => item.kind === "capture-review");
  assert.equal(reviews.length, 2);
  assert.deepEqual(
    reviews.map((item) => (item.data as { attempt?: number }).attempt),
    [1, 2],
  );
  assert.equal(
    (reviews[0]?.data as { imageSha256?: string }).imageSha256,
    (reviews[1]?.data as { imageSha256?: string }).imageSha256,
  );
  assert.notEqual(
    (reviews[0]?.data as { slotId?: string }).slotId,
    (reviews[1]?.data as { slotId?: string }).slotId,
  );
  assert.notEqual(
    (reviews[0]?.data as { framePath?: string }).framePath,
    (reviews[1]?.data as { framePath?: string }).framePath,
  );
  assert.equal(ctx.plannedSlots.length, 2);
  assert.deepEqual(
    ctx.plannedSlots.map((item) => item.attempt),
    [1, 2],
  );
});

test("leftover skip chrome does not assign a recapture attempt", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [
    {
      kind: "conditional-step-skipped",
      capturedAt: 1,
      data: { reason: "inspect-setup-skipped", coverage: "inspect" },
    },
  ];
  const slot = {
    requirementId: "review-settings",
    checkpointId: "settings",
    invocation: "module:settings-inventory#0",
    iteration: 0,
  };
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Settings",
      {
        artifacts,
        log: () => {},
        captureReview: { ...slot, attempt: 99, moduleCalls: new Map() },
        plannedSlots: [
          {
            ...slot,
            attempt: 1,
            caption: "Settings",
            stepId: "settings",
          },
        ],
      },
      { captureScreenshot: async () => ({ ...frame("panel"), framePath: "frames/001.png" }) },
      { review: { mode: "later" }, stepId: slot.checkpointId },
    ),
  );
  const reviews = artifacts.filter((item) => item.kind === "capture-review");
  assert.equal(reviews.length, 1);
  assert.equal((reviews[0]?.data as { attempt?: number }).attempt, 1);
});

function pixel(text: string, capturedAt: number): ScreenshotPayload {
  return { ...frame(text), capturedAt, framePath: "frames/001.png" };
}

function matrixJob(artifacts: { kind: string; capturedAt: number; data: unknown }[]) {
  return { id: "review-job", batchId: "matrix-1", artifacts, platform: "android" } as never;
}

function snapshotDevice(snapshot: () => Promise<unknown>): Device {
  return {
    command: { wait: async () => ({}) },
    capture: { snapshot },
  } as unknown as Device;
}

test("fast review capture keeps the image when follow-on tree throws", async () => {
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const screenshotAt = 1_000;
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      snapshotDevice(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("accessibility snapshot timed out");
      }),
      "Settings",
      { artifacts, log: () => {}, job: matrixJob(artifacts) },
      { captureScreenshot: async () => pixel("now", screenshotAt) },
      { review: { mode: "later", policy: "fast" } },
    ),
  );
  const settling = artifacts.find((item) => item.kind === "visual-settling");
  const review = artifacts.find((item) => item.kind === "capture-review");
  const tree = artifacts.find((item) => item.kind === "ui-tree");
  const settlingData = settling?.data as {
    settled?: boolean;
    samples?: number;
    stabilityMeasured?: boolean;
  };
  assert.deepEqual(
    [settlingData.settled, settlingData.samples, settlingData.stabilityMeasured],
    [false, 1, false],
  );
  assert.equal((review?.data as { status?: string }).status, "pending");
  assert.equal((review?.data as { framePath?: string }).framePath, "frames/001.png");
  assert.equal(settling?.capturedAt, screenshotAt);
  assert.equal(review?.capturedAt, screenshotAt);
  assert.equal((tree?.data as { status?: string }).status, "failed");
  assert.match(String((tree?.data as { error?: string }).error), /timed out/u);
  assert.ok((tree?.capturedAt ?? 0) > screenshotAt);
  assert.ok((tree?.capturedAt ?? 0) > (review?.capturedAt ?? 0));
});

test("sequence phase capture keeps the image when follow-on tree throws", async () => {
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const screenshotAt = 2_000;
  const review = {
    mode: "later" as const,
    policy: "sequence" as const,
    phases: [
      { id: "before", caption: "Before airplane" },
      { id: "during", caption: "During airplane", intervalMs: 60_000 },
    ],
  };
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      snapshotDevice(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("accessibility snapshot timed out");
      }),
      "Survival",
      { artifacts, log: () => {}, job: matrixJob(artifacts) },
      { captureScreenshot: async () => pixel("before", screenshotAt) },
      { review, stepId: "interrupt" },
    ),
  );
  const image = artifacts.find((item) => item.kind === "capture-review");
  const tree = artifacts.find((item) => item.kind === "ui-tree");
  assert.equal((image?.data as { status?: string }).status, "pending");
  assert.equal((image?.data as { phase?: string }).phase, "before");
  assert.equal((image?.data as { framePath?: string }).framePath, "frames/001.png");
  assert.equal(image?.capturedAt, screenshotAt);
  assert.equal((tree?.data as { status?: string }).status, "failed");
  assert.notEqual(tree?.capturedAt, screenshotAt);
  assert.ok((tree?.capturedAt ?? 0) > screenshotAt);
  assert.notEqual((tree?.data as { framePath?: string }).framePath, undefined);
});

test(
  "fast review capture does not wait out a hung follow-on tree",
  { timeout: 2_000 },
  async () => {
    const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
    const started = Date.now();
    await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
      captureRecipeScreenshot(
        snapshotDevice(() => new Promise(() => {})),
        "Settings",
        { artifacts, log: () => {}, job: matrixJob(artifacts) },
        { captureScreenshot: async () => pixel("now", 1_000) },
        { review: { mode: "later", policy: "fast" } },
      ),
    );
    assert.ok(Date.now() - started < 1_500);
    const review = artifacts.find((item) => item.kind === "capture-review");
    const tree = artifacts.find((item) => item.kind === "ui-tree");
    assert.equal((review?.data as { status?: string }).status, "pending");
    assert.equal((review?.data as { stabilityMeasured?: boolean }).stabilityMeasured, false);
    assert.equal((review?.data as { policy?: string }).policy, "fast");
    assert.equal((tree?.data as { status?: string }).status, "failed");
    assert.ok((tree?.capturedAt ?? 0) > 1_000);
  },
);

test("stable review capture still samples matching rasters", async () => {
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  let snapshots = 0;
  let captures = 0;
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      snapshotDevice(async () => {
        snapshots += 1;
        return [];
      }),
      "Settings",
      { artifacts, log: () => {}, job: matrixJob(artifacts) },
      {
        captureScreenshot: async () => {
          captures += 1;
          return { ...frame("stable"), framePath: "frames/001.png" };
        },
      },
      { review: { mode: "later", policy: "stable" } },
    ),
  );
  assert.ok(captures >= 2);
  assert.equal(snapshots, 1);
  const settling = artifacts.find((item) => item.kind === "visual-settling");
  const settlingData = settling?.data as {
    stabilityMeasured?: boolean;
    samples?: number;
    settled?: boolean;
    policy?: string;
  };
  assert.equal(settlingData.stabilityMeasured, true);
  assert.ok((settlingData.samples ?? 0) >= 2);
  assert.equal(settlingData.settled, true);
  assert.equal(settlingData.policy, "stable");
  assert.equal(
    artifacts.some((item) => item.kind === "capture-review"),
    true,
  );
});

test("dest-phase Fast capture stays dest identity when leftover Close also captures", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  let captures = 0;
  const planned = [
    {
      checkpointId: "open-sidebar-dest",
      caption: "Sidebar",
      lookFor: "Automations",
      attempt: 1,
      phase: CAPTURE_REVIEW_DEST_PHASE,
      stepId: "open-sidebar-dest",
    },
  ];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Sidebar",
      { artifacts, log: () => {}, plannedSlots: [...planned] },
      {
        captureScreenshot: async () => {
          captures += 1;
          return { ...frame("automations"), framePath: "frames/002.png" };
        },
      },
      {
        review: {
          mode: "later",
          lookFor: "Automations",
          phase: CAPTURE_REVIEW_DEST_PHASE,
        },
        stepId: "open-sidebar-dest",
      },
    ),
  );
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Home leftover",
      { artifacts, log: () => {}, plannedSlots: [...planned] },
      {
        captureScreenshot: async () => {
          captures += 1;
          return { ...frame("home"), framePath: "frames/005.png" };
        },
      },
      {
        review: {
          mode: "later",
          lookFor: "Speak home chrome",
          phase: CAPTURE_REVIEW_LEFTOVER_PHASE,
        },
        stepId: "open-sidebar-dest",
      },
    ),
  );
  assert.equal(captures, 2);
  const dest = artifacts.find(
    (item) =>
      item.kind === "capture-review" &&
      (item.data as { phase?: string }).phase === CAPTURE_REVIEW_DEST_PHASE,
  )?.data as {
    phase?: string;
    framePath?: string;
    stabilityMeasured?: boolean;
    policy?: string;
    samples?: number;
  };
  const leftover = artifacts.find(
    (item) =>
      item.kind === "capture-review" &&
      (item.data as { phase?: string }).phase === CAPTURE_REVIEW_LEFTOVER_PHASE,
  )?.data as { phase?: string; framePath?: string };
  assert.equal(dest.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(dest.framePath, "frames/002.png");
  assert.equal(dest.stabilityMeasured, false);
  assert.equal(dest.policy, "fast");
  assert.equal(dest.samples, 1);
  assert.equal(leftover.phase, CAPTURE_REVIEW_LEFTOVER_PHASE);
  assert.equal(leftover.framePath, "frames/005.png");
  const queue = resolveCaptureReviewQueue({ plannedSlots: planned, artifacts });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(queue.items[0]?.framePath, "frames/002.png");
  assert.equal(queue.items[0]?.stabilityMeasured, false);
  assert.equal(queue.items[0]?.policy, "fast");
});

test("expect-screen still fails closed when identity has no tree", async () => {
  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "android", serial: "identity" }, () =>
      runExpectScreenStep(
        snapshotDevice(async () => []),
        {
          kind: "expect-screen",
          screenId: "settings",
          screenTitle: "Settings",
          fingerprint: "a".repeat(64),
          timeoutMs: 0,
        },
        {
          log: () => {},
          job: { id: "identity", platform: "android", artifacts: [] } as never,
          runtime: {},
        },
        {
          captureScreenshot: async () => pixel("settings", 1),
          observeSnapshot: async () => [],
        },
      ),
    ),
    /screen-inspection-unavailable/u,
  );
});
