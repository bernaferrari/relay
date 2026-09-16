import assert from "node:assert/strict";
import test from "node:test";
import {
  assignCaptureReviewAttempt,
  captureReviewAdvanceIndex,
  captureReviewCheckpointFamilyId,
  captureReviewCoverageLine,
  captureReviewId,
  captureReviewIdentityFramePaths,
  captureReviewSlotFamilyId,
  captureReviewSlotId,
  CAPTURE_REVIEW_ACTIONS,
  CAPTURE_REVIEW_DEST_PHASE,
  CAPTURE_REVIEW_LEFTOVER_PHASE,
  formatCaptureReviewConfiguration,
  formatCaptureReviewCoverageSummary,
  materializeCaptureReviewSlots,
  observedCaptureReviewAccount,
  BLOCKED_CAPTURE_REVIEW_ACCOUNT,
  resolveCaptureReviewQueue,
  summarizeCaptureReview,
} from "./capture-review.js";
import { VISUAL_REVIEW_ACTIONS } from "./visual-verification.js";
import {
  captureRasterPolicyMeasuresStability,
  DEFAULT_CAPTURE_RASTER_POLICY,
  resolvedCaptureRasterPolicy,
} from "./recipes.js";

test("arrow keys move the contact sheet without wrapping past the ends", () => {
  assert.equal(captureReviewAdvanceIndex(0, 8, "ArrowRight"), 1);
  assert.equal(captureReviewAdvanceIndex(7, 8, "ArrowRight"), 7);
  assert.equal(captureReviewAdvanceIndex(3, 8, "ArrowLeft"), 2);
  assert.equal(captureReviewAdvanceIndex(0, 8, "Home"), 0);
  assert.equal(captureReviewAdvanceIndex(2, 8, "End"), 7);
  assert.equal(captureReviewAdvanceIndex(2, 8, "Enter"), undefined);
});

test("eight intended captures stay pending until a person reviews the exact image", () => {
  const roles = ["Member", "Admin"] as const;
  const viewports = ["Desktop", "Compact"] as const;
  const languages = ["English", "Arabic"] as const;
  const artifacts = roles.flatMap((role) =>
    viewports.flatMap((viewport) =>
      languages.map((language) => {
        const caption = `${role} · ${viewport} · ${language}`;
        const framePath = `frames/${caption.replaceAll(" · ", "-").toLowerCase()}.png`;
        const imageSha256 = captureReviewId({ caption, framePath, imageSha256: "hash" }).slice(-4);
        return {
          kind: "capture-review",
          data: {
            status: "pending",
            caption,
            lookFor: "Arabic text is readable and Save is visible.",
            framePath,
            imageSha256: `${imageSha256}${caption.length}`,
            configuration: { account: role, viewport, locale: language },
          },
        };
      }),
    ),
  );
  const queue = resolveCaptureReviewQueue({ artifacts });
  assert.equal(queue.items.length, 8);
  assert.equal(new Set(queue.items.map((item) => item.caption)).size, 8);
  assert.equal(
    queue.items.every((item) => formatCaptureReviewConfiguration(item.configuration).length === 3),
    true,
  );
  assert.equal(captureReviewCoverageLine(queue.summary), "8/8 captured");
  assert.equal(
    formatCaptureReviewCoverageSummary({ ...queue.summary, planned: 8, blocked: 0 }),
    "8 planned · 8 captured · 0 blocked · 0 missing · 8 pending · 0 accepted",
  );
  assert.deepEqual(queue.summary, {
    captured: 8,
    missing: 0,
    pending: 8,
    accepted: 0,
    issue: 0,
    needMoreEvidence: 0,
  });
});

const labFixture = "authfx:7189423f-193e-45ed-b674-154505cc5107:1";

test("Lane name grok-lab without a fixture is signed-out, not SuperGrok", () => {
  const labeled = observedCaptureReviewAccount({
    laneId: "grok-lab",
    unsignedLaneId: "grok-lab",
    targetProfileId: "browser:grok-com",
    resolvedAccount: "SuperGrok",
  });
  assert.equal(labeled.account, "signed-out");
  assert.equal(labeled.observed.laneId, "grok-lab");
  assert.notEqual(labeled.account, "SuperGrok");
});

test("unsigned grok-daily cannot be labeled grok-lab SuperGrok by overlay", () => {
  const labeled = observedCaptureReviewAccount({
    laneId: "grok-daily",
    unsignedLaneId: "grok-daily",
    targetProfileId: "browser:grok-com",
    resolvedAccount: "SuperGrok",
  });
  assert.equal(labeled.account, "signed-out");
  assert.equal(labeled.observed.laneId, "grok-daily");
  assert.equal(labeled.observed.profileId, "browser:grok-com");
});

test("grok-lab fixture is the observed account, not a daily overlay or Lane name", () => {
  const labeled = observedCaptureReviewAccount({
    laneId: "grok-lab",
    targetProfileId: "browser:grok-com-1280x800-339a5a430a41",
    authenticationFixtureId: labFixture,
    resolvedAccount: "signed-out",
  });
  assert.equal(labeled.account, labFixture);
  assert.equal(labeled.observed.laneId, "grok-lab");
  assert.equal(labeled.observed.profileId, "browser:grok-com-1280x800-339a5a430a41");
});

test("expired fixture cannot stamp fixture account on capture-review", () => {
  const labeled = observedCaptureReviewAccount({
    laneId: "grok-lab",
    targetProfileId: "browser:grok-com-1280x800-339a5a430a41",
    authenticationFixtureId: labFixture,
    fixtureName: "SuperGrok",
    fixtureHealthStatus: "expired",
    resolvedAccount: "SuperGrok",
  });
  assert.equal(labeled.account, BLOCKED_CAPTURE_REVIEW_ACCOUNT);
  assert.notEqual(labeled.account, "SuperGrok");
  assert.notEqual(labeled.account, labFixture);
  assert.equal(labeled.observed.laneId, "grok-lab");
});

test("errored fixture with readyCount 0 is blocked, not SuperGrok", () => {
  const labeled = observedCaptureReviewAccount({
    laneId: "grok-lab",
    authenticationFixtureId: labFixture,
    fixtureName: "SuperGrok",
    fixtureHealthStatus: "error",
    readyCount: 0,
    resolvedAccount: "SuperGrok",
  });
  assert.equal(labeled.account, BLOCKED_CAPTURE_REVIEW_ACCOUNT);
  assert.equal(labeled.observed.laneId, "grok-lab");
});

test("observed lane and profile are display metadata and do not enter slotId", () => {
  const configuration = { account: "signed-out", browser: "chromium" };
  const slotId = captureReviewSlotId({ checkpointId: "home", configuration });
  const queue = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Home",
          framePath: "frames/home.png",
          imageSha256: "abc",
          checkpointId: "home",
          slotId,
          configuration,
          observed: {
            laneId: "grok-daily",
            profileId: "browser:grok-com",
            sessionStore: "playwright-user-data",
          },
        },
      },
    ],
  });
  assert.equal(queue.items[0]?.slotId, slotId);
  assert.match(slotId, /signed-out/u);
  assert.doesNotMatch(slotId, /grok-daily/u);
  assert.doesNotMatch(slotId, /browser:grok-com/u);
  assert.equal(queue.items[0]?.observed?.laneId, "grok-daily");
  assert.equal(queue.items[0]?.observed?.sessionStore, "playwright-user-data");
  assert.equal(queue.items[0]?.configuration?.account, "signed-out");
});

test("a missing screenshot stays missing and a later image does not inherit an older accept", () => {
  const first = {
    kind: "capture-review",
    data: {
      caption: "Arabic account settings",
      framePath: "frames/001.png",
      imageSha256: "aaa",
    },
  };
  const accepted = resolveCaptureReviewQueue({
    artifacts: [first],
    decisions: [
      {
        captureId: captureReviewId({
          caption: "Arabic account settings",
          framePath: "frames/001.png",
          imageSha256: "aaa",
        }),
        action: "accept",
        imageSha256: "aaa",
        decidedAt: 1,
        decidedBy: { id: "human:maria", kind: "human" },
      },
    ],
  });
  assert.equal(accepted.items[0]?.status, "accepted");

  const recaptured = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Arabic account settings",
          framePath: "frames/001.png",
          imageSha256: "bbb",
        },
      },
    ],
    decisions: accepted.items[0]
      ? [
          {
            captureId: accepted.items[0].captureId,
            action: "accept",
            imageSha256: "aaa",
            decidedAt: 1,
            decidedBy: { id: "human:maria", kind: "human" },
          },
        ]
      : [],
  });
  assert.equal(recaptured.items[0]?.status, "pending");
  assert.equal(recaptured.items[0]?.imageSha256, "bbb");

  const missing = resolveCaptureReviewQueue({
    recipeSteps: [
      {
        kind: "screenshot",
        caption: "Arabic account settings",
        review: { mode: "later", lookFor: "Save is visible" },
      },
    ],
  });
  assert.equal(missing.items[0]?.status, "missing");
  assert.equal(missing.summary.missing, 1);
  assert.equal(missing.summary.captured, 0);
});

test("summary never treats captured files as verified", () => {
  assert.deepEqual(
    summarizeCaptureReview([
      { captureId: "a", caption: "A", status: "pending" },
      { captureId: "b", caption: "B", status: "accepted" },
      { captureId: "c", caption: "C", status: "issue" },
      { captureId: "d", caption: "D", status: "missing" },
    ]),
    {
      captured: 3,
      missing: 1,
      pending: 1,
      accepted: 1,
      issue: 1,
      needMoreEvidence: 0,
    },
  );
  assert.equal(
    captureReviewCoverageLine({
      captured: 47,
      missing: 3,
      pending: 40,
      accepted: 5,
      issue: 2,
      needMoreEvidence: 0,
    }),
    "47/50 captured",
  );
});

test("accepting selected captures does not approve an unselected image", () => {
  const artifacts = Array.from({ length: 12 }, (_, index) => ({
    kind: "capture-review",
    data: {
      caption: `Cell ${index + 1}`,
      framePath: `frames/${String(index + 1).padStart(3, "0")}.png`,
      imageSha256: `hash-${index + 1}`,
    },
  }));
  const selected = artifacts.slice(0, 10).map((artifact) => {
    const data = artifact.data;
    return {
      captureId: captureReviewId({
        caption: data.caption,
        framePath: data.framePath,
        imageSha256: data.imageSha256,
      }),
      action: "accept" as const,
      imageSha256: data.imageSha256,
      decidedAt: 1,
      decidedBy: { id: "human:maria", kind: "human" as const },
    };
  });
  const queue = resolveCaptureReviewQueue({ artifacts, decisions: selected });
  assert.equal(queue.summary.accepted, 10);
  assert.equal(queue.summary.pending, 2);
  assert.equal(queue.items.at(-1)?.status, "pending");
  assert.equal(queue.items[0]?.status, "accepted");
});

test("unscoped identity-ignore is not a capture-review mask", () => {
  const queue = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Chat",
          framePath: "frames/001.png",
          imageSha256: "chat",
          stepId: "chat",
        },
      },
      {
        kind: "identity-ignore",
        data: {
          name: "reply body",
          x: 0,
          y: 0.1,
          width: 1,
          height: 0.8,
        },
      },
    ],
  });
  assert.equal(queue.items[0]?.masks, undefined);
});

test("a chat identity-ignore overlay stays off a later settings capture", () => {
  const queue = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Chat",
          framePath: "frames/001.png",
          imageSha256: "chat",
          stepId: "chat",
        },
      },
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/002.png",
          imageSha256: "settings",
          stepId: "settings",
        },
      },
      {
        kind: "identity-ignore",
        data: {
          name: "reply body",
          x: 0,
          y: 0.1,
          width: 1,
          height: 0.8,
          stepId: "chat",
          frameIndex: 0,
        },
      },
    ],
  });
  assert.equal(queue.items[0]?.masks, undefined);
  assert.equal(queue.items[1]?.masks, undefined);
});

test("identity-ignore kind on a capture-review mask is dropped", () => {
  const queue = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Chat",
          framePath: "frames/001.png",
          imageSha256: "chat",
          stepId: "chat",
          masks: [
            { kind: "identity-ignore", name: "clock", x: 0.8, y: 0, width: 0.2, height: 0.05 },
          ],
        },
      },
    ],
  });
  assert.equal(queue.items[0]?.masks, undefined);
});

test("Use as baseline remains a separate explicit action from Looks correct", () => {
  assert.deepEqual([...CAPTURE_REVIEW_ACTIONS], ["accept", "report-issue", "need-more-evidence"]);
  assert.equal(
    (CAPTURE_REVIEW_ACTIONS as readonly string[]).includes("approve-new-baseline"),
    false,
  );
  assert.equal(VISUAL_REVIEW_ACTIONS.includes("approve-new-baseline"), true);
});

test("an explicit capture-review mask stays on the selected chat frame", () => {
  const queue = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Chat",
          framePath: "frames/001.png",
          imageSha256: "chat",
          stepId: "chat",
          masks: [{ name: "reply body", x: 0, y: 0.1, width: 1, height: 0.8 }],
        },
      },
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/002.png",
          imageSha256: "settings",
          stepId: "settings",
        },
      },
    ],
  });
  assert.equal(queue.items[0]?.masks?.length, 1);
  assert.equal(queue.items[0]?.masks?.[0]?.name, "reply body");
  assert.equal(queue.items[1]?.masks, undefined);
});

test("duplicate Settings captions stay two planned slots when only one image exists", () => {
  const queue = resolveCaptureReviewQueue({
    recipeSteps: [
      {
        id: "settings-before-language",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later", lookFor: "English section list" },
      },
      {
        id: "settings-after-language",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later", lookFor: "Arabic section list" },
      },
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/001.png",
          imageSha256: "same-pixels",
          stepId: "settings-before-language",
        },
      },
    ],
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(captureReviewCoverageLine(queue.summary), "1/2 captured");
  assert.equal(queue.items[0]?.caption, "Settings");
  assert.equal(queue.items[1]?.caption, "Settings");
  assert.equal(queue.items[0]?.status, "pending");
  assert.equal(queue.items[1]?.status, "missing");
  assert.notEqual(queue.items[0]?.captureId, queue.items[1]?.captureId);
  assert.equal(queue.items[0]?.checkpointId, "settings-before-language");
  assert.equal(queue.items[1]?.checkpointId, "settings-after-language");
});

test("a skipped nested routine keeps its capture slots in the denominator", () => {
  const queue = resolveCaptureReviewQueue({
    requirementId: "GQA-040",
    recipeSteps: [
      {
        id: "home",
        kind: "screenshot",
        caption: "Home",
        review: { mode: "later", lookFor: "Composer empty" },
      },
      { kind: "module", recipeId: "settings-inventory" },
    ],
    recipes: {
      "settings-inventory": {
        steps: [
          {
            id: "settings-en",
            kind: "screenshot",
            caption: "Settings",
            review: { mode: "later", lookFor: "Account section" },
          },
        ],
      },
    },
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Home",
          framePath: "frames/001.png",
          imageSha256: "home",
          stepId: "home",
        },
      },
    ],
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.items[1]?.status, "missing");
  assert.equal(queue.items[1]?.checkpointId, "settings-en");
  assert.equal(queue.items[1]?.invocation, "module:settings-inventory#0");
});

test("an early-stopped language loop cannot shrink later iterations away", () => {
  const queue = resolveCaptureReviewQueue({
    requirementId: "GQA-041",
    configuration: { locale: "plan" },
    recipeSteps: [{ kind: "repeat", count: 3, recipeId: "language-settings" }],
    recipes: {
      "language-settings": {
        steps: [
          {
            id: "settings",
            kind: "screenshot",
            caption: "Settings",
            review: { mode: "later", lookFor: "Language row" },
          },
        ],
      },
    },
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/001.png",
          imageSha256: "en",
          stepId: "settings",
          iteration: 0,
        },
      },
    ],
  });
  assert.equal(queue.items.length, 3);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 2);
  assert.deepEqual(
    queue.items.map((item) => item.iteration),
    [0, 1, 2],
  );
  assert.equal(queue.items[0]?.status, "pending");
  assert.equal(queue.items[1]?.status, "missing");
  assert.equal(queue.items[2]?.status, "missing");
});

test("identical PNG bytes still keep two review obligations", () => {
  const queue = resolveCaptureReviewQueue({
    recipeSteps: [
      {
        id: "web-settings",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later" },
      },
      {
        id: "ios-settings",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later" },
      },
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/web.png",
          imageSha256: "identical-bytes",
          stepId: "web-settings",
          configuration: { browser: "chromium" },
        },
      },
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/ios.png",
          imageSha256: "identical-bytes",
          stepId: "ios-settings",
          configuration: { app: "ai.x.GrokApp" },
        },
      },
    ],
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 2);
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.items[0]?.imageSha256, queue.items[1]?.imageSha256);
  assert.notEqual(queue.items[0]?.captureId, queue.items[1]?.captureId);
  assert.equal(queue.items[0]?.checkpointId, "web-settings");
  assert.equal(queue.items[1]?.checkpointId, "ios-settings");
});

test("frozen plannedSlots keep nested and loop obligations when recipes are incomplete", () => {
  const plannedSlots = materializeCaptureReviewSlots({
    requirementId: "GQA-040",
    recipeSteps: [
      {
        id: "settings-before-language",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later", lookFor: "English section list" },
      },
      {
        id: "settings-after-language",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later", lookFor: "Arabic section list" },
      },
      { kind: "module", recipeId: "settings-inventory" },
      { kind: "repeat", count: 3, recipeId: "language-settings" },
    ],
    recipes: {
      "settings-inventory": {
        steps: [
          {
            id: "settings-en",
            kind: "screenshot",
            caption: "Account",
            review: { mode: "later", lookFor: "Account section" },
          },
        ],
      },
      "language-settings": {
        steps: [
          {
            id: "language-row",
            kind: "screenshot",
            caption: "Language",
            review: { mode: "later", lookFor: "Language row" },
          },
        ],
      },
    },
  });
  assert.equal(plannedSlots.length, 6);
  const first = plannedSlots[0]!;
  const queue = resolveCaptureReviewQueue({
    plannedSlots,
    recipeSteps: [
      {
        id: "settings-before-language",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later" },
      },
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/001.png",
          imageSha256: "before",
          slotId: captureReviewSlotId(first),
          stepId: first.stepId,
          checkpointId: first.checkpointId,
          invocation: first.invocation,
        },
      },
    ],
  });
  assert.equal(queue.items.length, plannedSlots.length);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 5);
  assert.equal(queue.items[0]?.status, "pending");
  assert.equal(queue.items[0]?.slotId, captureReviewSlotId(first));
  assert.equal(queue.items[1]?.caption, "Settings");
  assert.equal(queue.items[1]?.status, "missing");
  assert.equal(queue.items[2]?.status, "missing");
  assert.equal(queue.items[2]?.invocation, "module:settings-inventory#0");
  assert.deepEqual(
    queue.items.slice(3).map((item) => item.iteration),
    [0, 1, 2],
  );
  assert.equal(queue.items[3]?.status, "missing");
});

test("frozen plannedSlots include screenshots in branch then and else bodies", () => {
  const plannedSlots = materializeCaptureReviewSlots({
    requirementId: "GQA-branch",
    recipeSteps: [
      {
        kind: "branch",
        input: "{{locale}}",
        operator: "equals",
        expected: "ar",
        thenRecipeId: "arabic-settings",
        elseRecipeId: "english-settings",
      },
    ],
    recipes: {
      "arabic-settings": {
        steps: [
          {
            id: "settings-ar",
            kind: "screenshot",
            caption: "Arabic Settings",
            review: { mode: "later", lookFor: "RTL section list" },
          },
        ],
      },
      "english-settings": {
        steps: [
          {
            id: "settings-en",
            kind: "screenshot",
            caption: "English Settings",
            review: { mode: "later", lookFor: "LTR section list" },
          },
        ],
      },
    },
  });
  assert.equal(plannedSlots.length, 2);
  assert.equal(plannedSlots[0]?.caption, "Arabic Settings");
  assert.equal(plannedSlots[1]?.caption, "English Settings");
  assert.equal(plannedSlots[0]?.invocation, "module:arabic-settings#0");
  assert.equal(plannedSlots[1]?.invocation, "module:english-settings#0");
  assert.equal(plannedSlots[0]?.checkpointId, "settings-ar");
  assert.equal(plannedSlots[1]?.checkpointId, "settings-en");
  assert.equal(new Set(plannedSlots.map((slot) => captureReviewSlotId(slot))).size, 2);
});

test("an empty frozen plannedSlots list does not reconstruct from recipes", () => {
  const queue = resolveCaptureReviewQueue({
    plannedSlots: [],
    recipeSteps: [
      {
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later" },
      },
    ],
  });
  assert.equal(queue.items.length, 0);
  assert.equal(queue.summary.missing, 0);
});

const recaptureCheckpoint = {
  requirementId: "GQA-settings",
  checkpointId: "settings",
  configuration: { account: "Member", locale: "ar" },
  invocation: "module:settings-inventory#0",
  iteration: 0,
} as const;

function recaptureSlot(attempt: number) {
  return {
    ...recaptureCheckpoint,
    attempt,
    caption: "Settings",
    lookFor: "Account section",
    stepId: "settings",
  };
}

function recaptureArtifact(attempt: number, frame: string, imageSha256: string) {
  const slot = recaptureSlot(attempt);
  return {
    kind: "capture-review",
    data: {
      caption: slot.caption,
      lookFor: slot.lookFor,
      framePath: frame,
      imageSha256,
      stepId: slot.stepId,
      slotId: captureReviewSlotId(slot),
      requirementId: slot.requirementId,
      checkpointId: slot.checkpointId,
      invocation: slot.invocation,
      iteration: slot.iteration,
      attempt: slot.attempt,
      configuration: slot.configuration,
    },
  };
}

test("plannedSlots keep attempt 1 and add attempt 2 after recapture of the same checkpoint", () => {
  const planned = materializeCaptureReviewSlots({
    requirementId: recaptureCheckpoint.requirementId,
    configuration: recaptureCheckpoint.configuration,
    recipeSteps: [
      {
        id: "settings",
        kind: "screenshot",
        caption: "Settings",
        review: { mode: "later", lookFor: "Account section" },
      },
    ],
  }).map((slot) => ({
    ...slot,
    invocation: recaptureCheckpoint.invocation,
    iteration: recaptureCheckpoint.iteration,
  }));
  assert.equal(planned.length, 1);
  assert.equal(planned[0]?.attempt, 1);
  assert.equal(planned[0]?.checkpointId, "settings");
  assert.equal(captureReviewSlotFamilyId(planned[0]!), captureReviewSlotFamilyId(recaptureSlot(1)));

  const first = assignCaptureReviewAttempt({
    plannedSlots: planned,
    captured: [],
    slot: recaptureSlot(1),
  });
  assert.equal(first.attempt, 1);
  assert.equal(first.plannedSlots.length, 1);
  assert.equal(first.plannedSlots[0]?.attempt, 1);

  const recaptured = assignCaptureReviewAttempt({
    plannedSlots: first.plannedSlots,
    captured: [recaptureSlot(1)],
    slot: recaptureSlot(1),
  });
  assert.equal(recaptured.attempt, 2);
  assert.equal(recaptured.plannedSlots.length, 2);
  assert.deepEqual(
    recaptured.plannedSlots.map((slot) => slot.attempt),
    [1, 2],
  );
  assert.equal(recaptured.plannedSlots[0]?.checkpointId, recaptured.plannedSlots[1]?.checkpointId);
  assert.equal(recaptured.plannedSlots[0]?.invocation, recaptured.plannedSlots[1]?.invocation);
  assert.equal(recaptured.plannedSlots[0]?.iteration, recaptured.plannedSlots[1]?.iteration);
  assert.deepEqual(
    recaptured.plannedSlots[0]?.configuration,
    recaptured.plannedSlots[1]?.configuration,
  );
  assert.notEqual(
    captureReviewSlotId(recaptured.plannedSlots[0]!),
    captureReviewSlotId(recaptured.plannedSlots[1]!),
  );
  assert.equal(
    captureReviewSlotFamilyId(recaptured.plannedSlots[0]!),
    captureReviewSlotFamilyId(recaptured.plannedSlots[1]!),
  );

  const queue = resolveCaptureReviewQueue({
    plannedSlots: recaptured.plannedSlots,
    artifacts: [
      recaptureArtifact(1, "frames/001.png", "identical-bytes"),
      recaptureArtifact(2, "frames/002.png", "identical-bytes"),
    ],
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 2);
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.summary.pending, 2);
  assert.equal(queue.items[0]?.imageSha256, queue.items[1]?.imageSha256);
  assert.notEqual(queue.items[0]?.captureId, queue.items[1]?.captureId);
  assert.deepEqual(
    queue.items.map((item) => item.attempt),
    [1, 2],
  );
});

test("Looks correct on attempt 1 does not accept a missing recapture attempt 2", () => {
  const planned = assignCaptureReviewAttempt({
    plannedSlots: [recaptureSlot(1)],
    captured: [recaptureSlot(1)],
    slot: recaptureSlot(1),
  }).plannedSlots;
  const firstId = captureReviewId({
    caption: "Settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const queue = resolveCaptureReviewQueue({
    plannedSlots: planned,
    artifacts: [recaptureArtifact(1, "frames/001.png", "aaa")],
    decisions: [
      {
        captureId: firstId,
        action: "accept",
        imageSha256: "aaa",
        decidedAt: 1,
        decidedBy: { id: "human:maria", kind: "human" },
      },
    ],
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(captureReviewCoverageLine(queue.summary), "1/2 captured");
  assert.equal(queue.items[0]?.status, "accepted");
  assert.equal(queue.items[0]?.attempt, 1);
  assert.equal(queue.items[1]?.status, "missing");
  assert.equal(queue.items[1]?.attempt, 2);
  assert.notEqual(queue.items[0]?.captureId, queue.items[1]?.captureId);
});

test("a frozen attempt-1 plan still grows when recapture artifacts arrive", () => {
  const queue = resolveCaptureReviewQueue({
    plannedSlots: [recaptureSlot(1)],
    artifacts: [
      recaptureArtifact(1, "frames/001.png", "identical-bytes"),
      recaptureArtifact(2, "frames/002.png", "identical-bytes"),
    ],
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 2);
  assert.deepEqual(
    queue.items.map((item) => item.attempt),
    [1, 2],
  );
});

test("leftover inspect chrome does not mint a recapture attempt", () => {
  const queue = resolveCaptureReviewQueue({
    plannedSlots: [recaptureSlot(1)],
    artifacts: [
      {
        kind: "conditional-step-skipped",
        data: { reason: "inspect-setup-skipped", coverage: "inspect" },
      },
      { kind: "coverage-step-result", data: { reason: "transition-executed" } },
      recaptureArtifact(1, "frames/001.png", "panel"),
    ],
  });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.attempt, 1);
  assert.equal(queue.summary.missing, 0);
});

test("omitted raster policy is Fast and only Stable measures matching screenshots", () => {
  assert.equal(DEFAULT_CAPTURE_RASTER_POLICY, "fast");
  assert.equal(resolvedCaptureRasterPolicy(undefined), "fast");
  assert.equal(resolvedCaptureRasterPolicy("fast"), "fast");
  assert.equal(resolvedCaptureRasterPolicy("stable"), "stable");
  assert.equal(resolvedCaptureRasterPolicy("sequence"), "sequence");
  assert.equal(captureRasterPolicyMeasuresStability(undefined), false);
  assert.equal(captureRasterPolicyMeasuresStability("fast"), false);
  assert.equal(captureRasterPolicyMeasuresStability("sequence"), false);
  assert.equal(captureRasterPolicyMeasuresStability("stable"), true);
});

function destEndSlot() {
  return {
    requirementId: "rc23-screenshot-first",
    checkpointId: "logo",
    caption: "Logo",
    lookFor: "Speak home chrome",
    stepId: "relay-test-logo-dest",
    attempt: 1,
    phase: CAPTURE_REVIEW_DEST_PHASE,
    configuration: { app: "android" },
  };
}

test("dest-end plannedSlots keep dest phase from Fast later-review", () => {
  const planned = materializeCaptureReviewSlots({
    requirementId: "rc23-screenshot-first",
    recipeSteps: [
      {
        id: "relay-test-logo-dest",
        kind: "screenshot",
        caption: "Logo",
        review: {
          mode: "later",
          lookFor: "Speak home chrome",
          policy: "fast",
          phase: CAPTURE_REVIEW_DEST_PHASE,
        },
      },
    ],
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(planned[0]?.checkpointId, "relay-test-logo-dest");
  assert.match(captureReviewSlotId(planned[0]!), /::dest$/u);
});

test("dest-end dest-phase identity is dest wait-for pixels, not leftover Close last-frame", () => {
  const dest = destEndSlot();
  const leftoverHome = {
    kind: "capture-review",
    data: {
      caption: dest.caption,
      lookFor: dest.lookFor,
      framePath: "frames/005.png",
      imageSha256: "home-leftover",
      stepId: dest.stepId,
      checkpointId: dest.checkpointId,
      attempt: 1,
      phase: CAPTURE_REVIEW_LEFTOVER_PHASE,
      configuration: dest.configuration,
    },
  };
  const destWait = {
    kind: "capture-review",
    data: {
      caption: dest.caption,
      lookFor: dest.lookFor,
      framePath: "frames/002.png",
      imageSha256: "automations-settings",
      stepId: dest.stepId,
      slotId: captureReviewSlotId(dest),
      checkpointId: dest.checkpointId,
      attempt: 1,
      phase: CAPTURE_REVIEW_DEST_PHASE,
      settled: false,
      samples: 1,
      stabilityMeasured: false,
      policy: "fast",
      configuration: dest.configuration,
    },
  };
  const queue = resolveCaptureReviewQueue({
    plannedSlots: [dest],
    artifacts: [leftoverHome, destWait],
  });
  assert.equal(queue.items[0]?.status, "pending");
  assert.equal(queue.items[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(queue.items[0]?.framePath, "frames/002.png");
  assert.equal(queue.items[0]?.imageSha256, "automations-settings");
  assert.equal(queue.items[0]?.stabilityMeasured, false);
  assert.equal(queue.items[0]?.policy, "fast");
  assert.notEqual(queue.items[0]?.framePath, "frames/005.png");
  assert.deepEqual(captureReviewIdentityFramePaths([leftoverHome, destWait]), ["frames/002.png"]);
});

test("dest-phase leftover Close still cannot bind dest", () => {
  const dest = destEndSlot();
  const leftoverClose = {
    kind: "capture-review",
    data: {
      caption: "Close",
      framePath: "frames/005.png",
      imageSha256: "close-leftover",
      stepId: dest.stepId,
      checkpointId: dest.checkpointId,
      attempt: 1,
      phase: CAPTURE_REVIEW_LEFTOVER_PHASE,
      configuration: dest.configuration,
    },
  };
  const queue = resolveCaptureReviewQueue({
    plannedSlots: [dest],
    artifacts: [leftoverClose],
  });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.status, "missing");
  assert.equal(queue.items[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(queue.items[0]?.framePath, undefined);
  assert.equal(queue.items[0]?.imageSha256, undefined);
  assert.deepEqual(captureReviewIdentityFramePaths([leftoverClose]), []);
});

test("inspect-setup-skipped leftover Type to imagine is not dest captured for Speak home", () => {
  const dest = destEndSlot();
  const leftoverImagine = {
    kind: "capture-review",
    data: {
      caption: dest.caption,
      lookFor: dest.lookFor,
      framePath: "frames/003.png",
      imageSha256: "type-to-imagine",
      stepId: dest.stepId,
      slotId: captureReviewSlotId(dest),
      checkpointId: dest.checkpointId,
      attempt: 1,
      configuration: dest.configuration,
    },
  };
  const queue = resolveCaptureReviewQueue({
    plannedSlots: [dest],
    artifacts: [
      {
        kind: "conditional-step-skipped",
        data: { reason: "inspect-setup-skipped", coverage: "inspect" },
      },
      leftoverImagine,
    ],
  });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.status, "missing");
  assert.equal(queue.items[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.summary.captured, 0);
  assert.deepEqual(captureReviewIdentityFramePaths([leftoverImagine]), []);
  const destFilled = resolveCaptureReviewQueue({
    plannedSlots: [dest],
    artifacts: [
      {
        kind: "conditional-step-skipped",
        data: { reason: "inspect-setup-skipped", coverage: "inspect" },
      },
      leftoverImagine,
      {
        kind: "capture-review",
        data: {
          ...leftoverImagine.data,
          framePath: "frames/002.png",
          imageSha256: "speak-home",
          phase: CAPTURE_REVIEW_DEST_PHASE,
        },
      },
    ],
  });
  assert.equal(destFilled.items[0]?.status, "pending");
  assert.equal(destFilled.items[0]?.framePath, "frames/002.png");
});

test("unphased leftover stays pending not missing", () => {
  const leftover = {
    requirementId: "rc23-screenshot-first",
    checkpointId: "logo",
    caption: "Logo",
    lookFor: "Speak home chrome",
    stepId: "relay-test-logo-leftover",
    attempt: 1,
    configuration: { app: "android" },
  };
  const queue = resolveCaptureReviewQueue({
    plannedSlots: [leftover],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: leftover.caption,
          lookFor: leftover.lookFor,
          framePath: "frames/005.png",
          imageSha256: "home-leftover",
          stepId: leftover.stepId,
          checkpointId: leftover.checkpointId,
          attempt: 1,
          configuration: leftover.configuration,
        },
      },
    ],
  });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.status, "pending");
  assert.equal(queue.items[0]?.phase, undefined);
  assert.equal(queue.items[0]?.framePath, "frames/005.png");
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.summary.pending, 1);
});

test("unphased slot ids stay stable when phase is omitted", () => {
  const unphased = captureReviewSlotId({ checkpointId: "settings", attempt: 1 });
  assert.equal(unphased, "::settings::::::::1");
  assert.equal(
    captureReviewSlotId({ checkpointId: "settings", attempt: 1, phase: "before" }),
    `${unphased}::before`,
  );
});

test("sequence with two named phases materializes two plannedSlots", () => {
  const plannedSlots = materializeCaptureReviewSlots({
    requirementId: "GQA-016",
    recipeSteps: [
      {
        id: "interrupt",
        kind: "screenshot",
        caption: "Survival",
        review: {
          mode: "later",
          policy: "sequence",
          lookFor: "Composer still reachable",
          phases: [
            { id: "before", caption: "Before airplane", lookFor: "Signed-in home" },
            {
              id: "during",
              caption: "During airplane",
              lookFor: "Reconnect or offline chrome",
              intervalMs: 60_000,
            },
          ],
        },
      },
    ],
  });
  assert.equal(plannedSlots.length, 2);
  assert.equal(plannedSlots[0]?.checkpointId, "interrupt");
  assert.equal(plannedSlots[1]?.checkpointId, "interrupt");
  assert.equal(plannedSlots[0]?.phase, "before");
  assert.equal(plannedSlots[1]?.phase, "during");
  assert.equal(plannedSlots[0]?.attempt, 1);
  assert.equal(plannedSlots[1]?.attempt, 1);
  assert.equal(plannedSlots[1]?.intervalMs, 60_000);
  assert.notEqual(plannedSlots[0]?.intervalMs, plannedSlots[1]?.intervalMs);
  assert.equal(
    captureReviewCheckpointFamilyId(plannedSlots[0]!),
    captureReviewCheckpointFamilyId(plannedSlots[1]!),
  );
  assert.notEqual(
    captureReviewSlotFamilyId(plannedSlots[0]!),
    captureReviewSlotFamilyId(plannedSlots[1]!),
  );
  assert.notEqual(captureReviewSlotId(plannedSlots[0]!), captureReviewSlotId(plannedSlots[1]!));
});

test("a missing sequence phase stays in the denominator", () => {
  const plannedSlots = materializeCaptureReviewSlots({
    requirementId: "GQA-016",
    recipeSteps: [
      {
        id: "interrupt",
        kind: "screenshot",
        caption: "Survival",
        review: {
          mode: "later",
          policy: "sequence",
          phases: [
            { id: "before", caption: "Before airplane" },
            { id: "during", caption: "During airplane" },
          ],
        },
      },
    ],
  });
  const first = plannedSlots[0]!;
  const queue = resolveCaptureReviewQueue({
    plannedSlots,
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: first.caption,
          framePath: "frames/001.png",
          imageSha256: "before",
          slotId: captureReviewSlotId(first),
          stepId: first.stepId,
          checkpointId: first.checkpointId,
          phase: first.phase,
          attempt: first.attempt,
          requirementId: first.requirementId,
        },
      },
    ],
  });
  assert.equal(queue.items.length, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(captureReviewCoverageLine(queue.summary), "1/2 captured");
  assert.equal(queue.items.find((item) => item.phase === "before")?.status, "pending");
  assert.equal(queue.items.find((item) => item.phase === "during")?.status, "missing");
});

test("sequence without named phases is not a silent Stable slot", () => {
  const plannedSlots = materializeCaptureReviewSlots({
    recipeSteps: [
      {
        id: "final",
        kind: "screenshot",
        caption: "Final screen",
        review: { mode: "later", policy: "sequence" },
      },
    ],
  });
  assert.equal(plannedSlots.length, 0);
});

test("a 10-second sequence phase is not the same obligation as a 1-minute phase", () => {
  const plannedSlots = materializeCaptureReviewSlots({
    recipeSteps: [
      {
        id: "outage",
        kind: "screenshot",
        caption: "Outage",
        review: {
          mode: "later",
          policy: "sequence",
          phases: [
            { id: "blip", caption: "Ten-second blip", intervalMs: 10_000 },
            { id: "minute", caption: "One-minute outage", intervalMs: 60_000 },
          ],
        },
      },
    ],
  });
  assert.equal(plannedSlots.length, 2);
  assert.equal(plannedSlots[0]?.intervalMs, 10_000);
  assert.equal(plannedSlots[1]?.intervalMs, 60_000);
  assert.notEqual(captureReviewSlotId(plannedSlots[0]!), captureReviewSlotId(plannedSlots[1]!));
});

test("a loading placeholder capture does not fill the Sequence after slot", () => {
  const plannedSlots = materializeCaptureReviewSlots({
    requirementId: "live-output",
    recipeSteps: [
      {
        id: "reply",
        kind: "screenshot",
        caption: "Response",
        review: {
          mode: "later",
          policy: "sequence",
          phases: [
            { id: "placeholder", caption: "Working", lookFor: "Working for 1s" },
            { id: "after", caption: "Final response", lookFor: "Copy response" },
          ],
        },
      },
    ],
  });
  const queue = resolveCaptureReviewQueue({
    plannedSlots,
    artifacts: [
      {
        kind: "capture-review",
        data: {
          status: "pending",
          caption: "Working",
          lookFor: "Working for 1s",
          framePath: "frames/001.png",
          imageSha256: "abc",
          checkpointId: "reply",
          phase: "placeholder",
          attempt: 1,
          requirementId: "live-output",
        },
      },
    ],
  });
  assert.equal(plannedSlots.length, 2);
  assert.equal(queue.items.find((item) => item.phase === "placeholder")?.status, "pending");
  assert.equal(queue.items.find((item) => item.phase === "after")?.status, "missing");
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
});
