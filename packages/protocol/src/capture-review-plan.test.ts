import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTURE_REVIEW_DEST_PHASE,
  CAPTURE_REVIEW_LEFTOVER_PHASE,
  captureReviewId,
  captureReviewSlotId,
} from "./capture-review.js";
import {
  captureReviewQueueItemKey,
  filterPlanCaptureReviewQueue,
  formatPlanCaptureReviewQueue,
  parsePlanCaptureReviewFilter,
  planCaptureReviewFilterOptions,
  resolvePlanCaptureReviewQueue,
  selectedPlanCaptureReviewItems,
} from "./capture-review-plan.js";

const settingsStep = {
  id: "settings",
  kind: "screenshot",
  caption: "Settings",
  review: { mode: "later", lookFor: "Account section" },
};

function capture(
  runId: string,
  frame: string,
  sha: string,
  extras: {
    caption?: string;
    checkpointId?: string;
    lookFor?: string;
    device?: string;
    account?: string;
    accepted?: boolean;
    observed?: {
      laneId?: string;
      profileId?: string;
      sessionStore?: "playwright-user-data" | "electron-partition";
    };
  } = {},
) {
  const caption = extras.caption ?? "Settings";
  const checkpointId = extras.checkpointId ?? "settings";
  return {
    runId,
    ...(extras.device ? { device: extras.device } : {}),
    recipeSteps: [
      {
        ...settingsStep,
        id: checkpointId,
        caption,
        review: { mode: "later", lookFor: extras.lookFor ?? "Account section" },
      },
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption,
          lookFor: extras.lookFor ?? "Account section",
          framePath: frame,
          imageSha256: sha,
          checkpointId,
          stepId: checkpointId,
          attempt: 1,
          ...(extras.account ? { configuration: { account: extras.account } } : {}),
          ...(extras.observed ? { observed: extras.observed } : {}),
        },
      },
    ],
    ...(extras.accepted
      ? {
          decisions: [
            {
              captureId: captureReviewId({ caption, framePath: frame, imageSha256: sha }),
              action: "accept" as const,
              decidedAt: 1,
              decidedBy: { id: "human:maria", kind: "human" as const },
              imageSha256: sha,
            },
          ],
        }
      : {}),
  };
}

test("a Plan queue aggregates captures across Runs without opening each Run", () => {
  const queue = resolvePlanCaptureReviewQueue([
    capture("run-member", "frames/001.png", "aaa"),
    {
      runId: "run-blocked",
      blocked: true,
      recipeSteps: [settingsStep],
      artifacts: [],
    },
    capture("run-admin", "frames/002.png", "bbb"),
  ]);
  assert.equal(queue.items.length, 3);
  assert.equal(queue.summary.planned, 3);
  assert.equal(queue.summary.captured, 2);
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.summary.blocked, 1);
  assert.equal(queue.summary.pending, 2);
  assert.equal(queue.items.filter((item) => item.blocked)[0]?.status, "missing");
  assert.equal(new Set(queue.items.map((item) => item.runId)).size, 3);
});

test("bulk Looks correct binds only the exact selected items", () => {
  const member = capture("run-member", "frames/001.png", "aaa");
  const admin = capture("run-admin", "frames/002.png", "bbb");
  const compact = capture("run-compact", "frames/003.png", "ccc");
  const queue = resolvePlanCaptureReviewQueue([member, admin, compact]);
  const memberId = captureReviewId({
    caption: "Settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const adminId = captureReviewId({
    caption: "Settings",
    framePath: "frames/002.png",
    imageSha256: "bbb",
  });
  const selected = selectedPlanCaptureReviewItems(queue, [
    { runId: "run-member", captureId: memberId, imageSha256: "aaa" },
    { runId: "run-admin", captureId: adminId, imageSha256: "bbb" },
  ]);
  assert.equal(selected.length, 2);
  assert.equal(
    selected.some((item) => item.runId === "run-compact"),
    false,
  );
  const later = resolvePlanCaptureReviewQueue([
    member,
    admin,
    compact,
    capture("run-later", "frames/004.png", "ddd"),
  ]);
  assert.equal(later.summary.planned, 4);
  const stillSelected = selectedPlanCaptureReviewItems(later, [
    { runId: "run-member", captureId: memberId, imageSha256: "aaa" },
    { runId: "run-admin", captureId: adminId, imageSha256: "bbb" },
  ]);
  assert.equal(stillSelected.length, 2);
  assert.equal(
    stillSelected.some((item) => item.runId === "run-later"),
    false,
  );
});

test("duplicate Settings captions stay two Plan slots when only one image exists", () => {
  const queue = resolvePlanCaptureReviewQueue([
    {
      runId: "run-settings",
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
    },
  ]);
  assert.equal(queue.summary.planned, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.items[0]?.caption, "Settings");
  assert.equal(queue.items[1]?.caption, "Settings");
  assert.notEqual(queue.items[0]?.captureId, queue.items[1]?.captureId);
  assert.equal(queue.items[0]?.checkpointId, "settings-before-language");
  assert.equal(queue.items[1]?.checkpointId, "settings-after-language");
});

test("Plan dest-phase slots keep dest pixels when leftover Close/Back is also recorded", () => {
  const dest = {
    requirementId: "rc23-screenshot-first",
    checkpointId: "logo",
    caption: "Logo",
    lookFor: "Speak home chrome",
    stepId: "relay-test-logo-dest",
    attempt: 1,
    phase: CAPTURE_REVIEW_DEST_PHASE,
    configuration: { app: "android" },
  };
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
      configuration: dest.configuration,
    },
  };
  const queue = resolvePlanCaptureReviewQueue([
    {
      runId: "run-logo",
      plannedSlots: [dest],
      artifacts: [leftoverHome, destWait],
    },
  ]);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.status, "pending");
  assert.equal(queue.items[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(queue.items[0]?.framePath, "frames/002.png");
  assert.equal(queue.items[0]?.imageSha256, "automations-settings");
  assert.notEqual(queue.items[0]?.framePath, "frames/005.png");
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 0);
});

test("a missing Plan capture stays in the denominator and cannot be selected", () => {
  const queue = resolvePlanCaptureReviewQueue([
    capture("run-member", "frames/001.png", "aaa"),
    { runId: "run-missing", recipeSteps: [settingsStep], artifacts: [] },
  ]);
  assert.equal(queue.summary.planned, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  const missing = queue.items.find((item) => item.status === "missing");
  assert.ok(missing);
  const selected = selectedPlanCaptureReviewItems(queue, [
    { runId: "run-missing", captureId: missing!.captureId },
  ]);
  assert.equal(selected.length, 0);
});

test("Plan item keys stay unique when two Runs share identical PNG bytes", () => {
  const queue = resolvePlanCaptureReviewQueue([
    capture("run-a", "frames/001.png", "identical-bytes"),
    capture("run-b", "frames/001.png", "identical-bytes"),
  ]);
  assert.equal(queue.items[0]?.captureId, queue.items[1]?.captureId);
  assert.equal(queue.items[0]?.imageSha256, queue.items[1]?.imageSha256);
  assert.notEqual(
    captureReviewQueueItemKey(queue.items[0]!),
    captureReviewQueueItemKey(queue.items[1]!),
  );
  assert.match(
    formatPlanCaptureReviewQueue(queue),
    /2 planned · 2 captured · 0 blocked · 0 missing/u,
  );
  assert.match(formatPlanCaptureReviewQueue(queue), /Looks correct does not approve/u);
});

test("Plan review filters pending, screen, and device or account without shrinking coverage counts", () => {
  const queue = resolvePlanCaptureReviewQueue([
    capture("run-member-settings", "frames/001.png", "aaa", {
      account: "Member",
      device: "iPad",
    }),
    capture("run-member-home", "frames/002.png", "bbb", {
      caption: "Home",
      checkpointId: "home",
      lookFor: "Composer is empty",
      account: "Member",
      device: "iPad",
    }),
    capture("run-admin-settings", "frames/003.png", "ccc", {
      account: "Admin",
      device: "Chrome",
      accepted: true,
    }),
  ]);
  assert.equal(queue.summary.planned, 3);
  assert.equal(queue.summary.captured, 3);
  assert.equal(queue.summary.pending, 2);
  assert.equal(queue.summary.accepted, 1);
  assert.deepEqual(planCaptureReviewFilterOptions(queue.items), {
    screens: ["Home", "Settings"],
    devices: ["Chrome", "iPad"],
    accounts: ["Admin", "Member"],
  });

  const pending = filterPlanCaptureReviewQueue(queue, { pending: true });
  assert.equal(pending.items.length, 2);
  assert.equal(pending.summary.planned, 3);
  assert.equal(pending.summary.accepted, 1);
  assert.equal(pending.summary.pending, 2);
  assert.equal(
    pending.items.some((item) => item.status === "accepted"),
    false,
  );

  const settings = filterPlanCaptureReviewQueue(queue, { screen: "Settings" });
  assert.equal(settings.items.length, 2);
  assert.equal(settings.summary.planned, 3);
  assert.equal(
    settings.items.every((item) => item.caption === "Settings"),
    true,
  );

  const memberIpad = filterPlanCaptureReviewQueue(queue, { account: "Member", device: "iPad" });
  assert.equal(memberIpad.items.length, 2);
  assert.equal(memberIpad.summary.captured, 3);
  assert.equal(
    memberIpad.items.every((item) => item.account === "Member" && item.device === "iPad"),
    true,
  );
});

test("filtered bulk Looks correct never binds hidden, unloaded, or later arrivals", () => {
  const memberSettings = capture("run-member-settings", "frames/001.png", "aaa", {
    account: "Member",
    device: "iPad",
  });
  const memberHome = capture("run-member-home", "frames/002.png", "bbb", {
    caption: "Home",
    checkpointId: "home",
    account: "Member",
    device: "iPad",
  });
  const admin = capture("run-admin-settings", "frames/003.png", "ccc", {
    account: "Admin",
    device: "Chrome",
  });
  const queue = resolvePlanCaptureReviewQueue([memberSettings, memberHome, admin]);
  const memberSettingsId = captureReviewId({
    caption: "Settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const memberHomeId = captureReviewId({
    caption: "Home",
    framePath: "frames/002.png",
    imageSha256: "bbb",
  });
  const adminId = captureReviewId({
    caption: "Settings",
    framePath: "frames/003.png",
    imageSha256: "ccc",
  });
  const laterId = captureReviewId({
    caption: "Settings",
    framePath: "frames/004.png",
    imageSha256: "ddd",
  });
  const selectedWhileFiltered = selectedPlanCaptureReviewItems(
    queue,
    [
      { runId: "run-member-settings", captureId: memberSettingsId, imageSha256: "aaa" },
      { runId: "run-member-home", captureId: memberHomeId, imageSha256: "bbb" },
      { runId: "run-admin-settings", captureId: adminId, imageSha256: "ccc" },
      { runId: "run-later", captureId: laterId, imageSha256: "ddd" },
    ],
    { pending: true, screen: "Settings", account: "Member", device: "iPad" },
  );
  assert.equal(selectedWhileFiltered.length, 1);
  assert.equal(selectedWhileFiltered[0]?.runId, "run-member-settings");
  assert.equal(
    selectedWhileFiltered.some((item) => item.runId === "run-member-home"),
    false,
  );
  assert.equal(
    selectedWhileFiltered.some((item) => item.runId === "run-admin-settings"),
    false,
  );
  assert.equal(
    selectedWhileFiltered.some((item) => item.runId === "run-later"),
    false,
  );
});

test("query pending/screen/device/account parse into a Plan review filter", () => {
  assert.equal(parsePlanCaptureReviewFilter({}), undefined);
  assert.deepEqual(parsePlanCaptureReviewFilter({ pending: "true", screen: " Settings " }), {
    pending: true,
    screen: "Settings",
  });
  assert.deepEqual(
    parsePlanCaptureReviewFilter({
      pending: "0",
      device: "iPad",
      account: "Member",
    }),
    { device: "iPad", account: "Member" },
  );
});

const labFixture = "authfx:7189423f-193e-45ed-b674-154505cc5107:1";

test("Plan review account filter uses the observed capture account, not a guessed overlay", () => {
  const queue = resolvePlanCaptureReviewQueue([
    {
      runId: "run-daily",
      account: "SuperGrok",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Home",
            framePath: "frames/daily.png",
            imageSha256: "daily",
            checkpointId: "home",
            configuration: { account: "signed-out" },
            observed: {
              laneId: "grok-daily",
              profileId: "browser:grok-com",
              sessionStore: "playwright-user-data",
            },
          },
        },
      ],
    },
    {
      runId: "run-lab",
      account: "signed-out",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Home",
            framePath: "frames/lab.png",
            imageSha256: "lab",
            checkpointId: "home",
            configuration: { account: labFixture },
            observed: {
              laneId: "grok-lab",
              profileId: "browser:grok-com-1280x800-339a5a430a41",
              sessionStore: "playwright-user-data",
            },
          },
        },
      ],
    },
  ]);
  assert.equal(queue.items[0]?.account, "signed-out");
  assert.equal(queue.items[0]?.observed?.laneId, "grok-daily");
  assert.equal(queue.items[1]?.account, labFixture);
  assert.equal(queue.items[1]?.observed?.profileId, "browser:grok-com-1280x800-339a5a430a41");
  const daily = filterPlanCaptureReviewQueue(queue, { account: "signed-out" });
  assert.equal(daily.items.length, 1);
  assert.equal(daily.items[0]?.runId, "run-daily");
  assert.equal(daily.summary.planned, 2);
  const lab = filterPlanCaptureReviewQueue(queue, { account: labFixture });
  assert.equal(lab.items.length, 1);
  assert.equal(lab.items[0]?.runId, "run-lab");
  const spoofed = filterPlanCaptureReviewQueue(queue, { account: "SuperGrok" });
  assert.equal(spoofed.items.length, 0);
  assert.equal(spoofed.summary.captured, 2);
});
