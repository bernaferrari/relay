import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityGateForRun,
  capabilityGateForSlot,
  classifyIosHardware,
  gatePlanCaptureReviewRuns,
  iosHardwareCovers,
  physicalImagineClaim,
  resolveGatedPlanCaptureReviewQueue,
  workbookCoverageAfterCompileAttempts,
} from "./capability-gate.js";
import { canCoverWorkbookFamily, SURVIVAL_FAMILY_ID } from "./execution-queue.js";
import type { CaptureReviewPlannedSlot } from "./capture-review.js";
import {
  coverByFindingSimilarlyNamedTest,
  evaluateWorkbookCoverage,
  originalIsCovered,
  parseWorkbookCoverageManifest,
  type WorkbookCoverageManifest,
  type WorkbookOriginal,
} from "./workbook-coverage.js";
import { suggestedExecutionQueueForOriginal } from "./workbook-coverage.js";

function homeSlot(platform: "android" | "ios" | "browser"): CaptureReviewPlannedSlot {
  return {
    checkpointId: "home",
    caption: "Home",
    attempt: 1,
    configuration:
      platform === "browser"
        ? { browser: "grok-com" }
        : { app: platform === "ios" ? "ai.x.GrokApp" : "android" },
  };
}

function imagineSlot(platform: "android" | "ios" | "browser"): CaptureReviewPlannedSlot {
  return {
    checkpointId: "imagine",
    caption: "Imagine",
    attempt: 1,
    configuration:
      platform === "browser"
        ? { browser: "grok-com" }
        : { app: platform === "ios" ? "ai.x.GrokApp" : "android" },
  };
}

test("empty adb keeps an Android Home plannedSlot blocked in the denominator", () => {
  const androidHome = {
    runId: "android-home",
    platform: "android" as const,
    device: "android",
    plannedSlots: [homeSlot("android")],
  };
  const webHome = {
    runId: "web-home",
    platform: "browser" as const,
    plannedSlots: [homeSlot("browser")],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Home",
          framePath: "frames/web-home.png",
          imageSha256: "web",
          checkpointId: "home",
          configuration: { browser: "grok-com" },
        },
      },
    ],
  };
  const inventory = { adbDeviceCount: 0, iosImagineTabPresent: false };
  const gated = gatePlanCaptureReviewRuns([webHome, androidHome], inventory);
  assert.equal(gated.length, 2);
  assert.equal(
    gated.some((run) => run.runId === "android-home"),
    true,
  );
  assert.equal(gated.find((run) => run.runId === "android-home")?.blocked, true);
  assert.equal(gated.find((run) => run.runId === "web-home")?.blocked ?? false, false);

  const queue = resolveGatedPlanCaptureReviewQueue([webHome, androidHome], inventory);
  assert.equal(queue.summary.planned, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.summary.blocked, 1);
  const android = queue.items.find((item) => item.runId === "android-home");
  assert.equal(android?.status, "missing");
  assert.equal(android?.blocked, true);
  assert.equal(android?.checkpointId, "home");
  assert.equal(android?.configuration?.app, "android");
  assert.equal(capabilityGateForRun(androidHome, inventory)?.kind, "unsupported");
});

test("iOS Imagine unresolved-step stays Unbound in the workbook denominator", () => {
  const original: WorkbookOriginal = {
    id: 37,
    gqaId: "GQA-037",
    name: "Imagine from menu",
    family: "S02",
    mergeMapRow: "'Merge map'!A40:G40",
    criteria: "The Imagine feed opens.",
    intent: "Click the Imagine button from the side menu.",
    evidencePacket: "transition",
    queue: "fast-ui",
    suggestedExecutionQueue: suggestedExecutionQueueForOriginal({
      id: 37,
      family: "S02",
      evidencePacket: "transition",
    }),
    gates: ["iOS Imagine Unbound: navigation.tab.imagine absent."],
    status: "unbound",
    bindings: [],
  };
  const manifest = parseWorkbookCoverageManifest(
    {
      schemaVersion: 1,
      id: "fixture",
      revision: 1,
      reviewedAt: "2026-09-16",
      source: {
        workbook: "grok-qa-graph.xlsx",
        sha256: "43a2ba192fde342e074b8dac805572b23136701d0662d0a9933cb8cacc81de7a",
        originals: "'Merge map'!A4:G61",
        families: "'Suite'!A4:H20",
        exclusions: "'Dead and skip'!A4:D10",
      },
      counts: {
        originals: 1,
        families: 1,
        excludedFamilies: [],
        activeFamilies: 1,
        globallyExcludedOriginals: 0,
        remainingBeforePlatformTierGates: 1,
      },
      conflicts: [],
      notWorkbookPacks: [
        {
          packId: "grok-ios-imagine",
          testIds: ["test-grok-ios-imagine"],
          note: "Compile unresolved-step. Not coverage.",
        },
      ],
      families: [
        {
          id: "S02",
          name: "Shell navigation",
          active: true,
          queue: "fast-ui",
          originalIds: [37],
          suiteRow: "'Suite'!A5:H5",
        },
      ],
      originals: [original],
    },
    { requireCompleteWorkbook: false },
  ) satisfies WorkbookCoverageManifest;
  const catalog = [{ id: "test-grok-ios-imagine", name: "Imagine", appMapId: "grok-ios" }];
  const report = workbookCoverageAfterCompileAttempts(manifest, catalog, [
    { testId: "test-grok-ios-imagine", errorCode: "unresolved-step" },
  ]);
  assert.equal(report.remainingBeforePlatformTierGates, 1);
  assert.equal(report.unboundCount, 1);
  assert.equal(report.boundCount, 0);
  assert.deepEqual(report.unboundOriginalIds, [37]);
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(originalIsCovered(original), false);
  assert.equal(coverByFindingSimilarlyNamedTest(original, catalog), false);
  assert.equal(evaluateWorkbookCoverage(manifest, catalog).unboundOriginalIds.includes(37), true);

  const imagineRun = {
    runId: "ios-imagine",
    platform: "ios" as const,
    plannedSlots: [imagineSlot("ios")],
  };
  const queue = resolveGatedPlanCaptureReviewQueue([imagineRun], {
    adbDeviceCount: 0,
    iosImagineTabPresent: false,
  });
  assert.equal(queue.summary.planned, 1);
  assert.equal(queue.summary.blocked, 1);
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.items[0]?.status, "missing");
  assert.equal(queue.items[0]?.blocked, true);
  assert.equal(queue.items[0]?.checkpointId, "imagine");
});

test("browser grok-lab Imagine is a labeled approximation, not physical iOS or Android", () => {
  const claim = physicalImagineClaim({
    caption: "Imagine",
    checkpointId: "imagine",
    platform: "browser",
    configuration: { browser: "grok-com" },
    observed: {
      laneId: "grok-lab",
      profileId: "browser:grok-com-1280x800-339a5a430a41",
      sessionStore: "playwright-user-data",
    },
  });
  assert.equal(claim.physical, false);
  assert.equal(claim.scenarioKind, "browser-approximation");
  assert.match(claim.reason, /not iOS\/Android physical Imagine/u);

  const electron = physicalImagineClaim({
    caption: "Imagine",
    checkpointId: "imagine",
    observed: { laneId: "persist:lane:grok-lab", sessionStore: "electron-partition" },
  });
  assert.equal(electron.physical, false);
  assert.equal(electron.scenarioKind, "browser-approximation");

  const simulator = physicalImagineClaim({
    caption: "Imagine",
    checkpointId: "imagine",
    platform: "ios",
    approximation: "simulator",
    configuration: { app: "ai.x.GrokApp" },
  });
  assert.equal(simulator.physical, false);
  assert.equal(simulator.scenarioKind, "simulator-approximation");

  const physicalIos = physicalImagineClaim({
    caption: "Imagine",
    checkpointId: "imagine",
    platform: "ios",
    configuration: { app: "ai.x.GrokApp" },
  });
  assert.equal(physicalIos.physical, true);

  const queue = resolveGatedPlanCaptureReviewQueue(
    [
      {
        runId: "lab-imagine",
        platform: "browser",
        approximation: "browser",
        observed: { laneId: "grok-lab", sessionStore: "playwright-user-data" },
        plannedSlots: [imagineSlot("browser")],
        artifacts: [
          {
            kind: "capture-review",
            data: {
              caption: "Imagine",
              framePath: "frames/lab-imagine.png",
              imageSha256: "lab",
              checkpointId: "imagine",
              configuration: { browser: "grok-com", account: "SuperGrok" },
              observed: { laneId: "grok-lab", sessionStore: "playwright-user-data" },
            },
          },
        ],
      },
    ],
    { adbDeviceCount: 0, iosImagineTabPresent: false },
  );
  assert.equal(queue.summary.planned, 1);
  assert.equal(queue.summary.blocked, 0);
  assert.equal(queue.items[0]?.configuration?.app, undefined);
  assert.equal(queue.items[0]?.configuration?.browser, "grok-com");
  assert.equal(queue.items[0]?.observed?.laneId, "grok-lab");
  assert.equal(queue.items[0]?.scenarioKind, "browser-approximation");
});

test("S16 60s dwell cannot be claimed by Fast UI 10s, and physical lock stays human-only", () => {
  assert.equal(
    canCoverWorkbookFamily({
      executionQueue: "fast-ui",
      declaredDwellMs: 10_000,
      family: SURVIVAL_FAMILY_ID,
    }).ok,
    false,
  );
  const lock = {
    runId: "ios-lock",
    platform: "ios" as const,
    plannedSlots: [
      {
        checkpointId: "lock",
        caption: "Lock",
        lookFor: "Lock screen",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" },
      },
    ],
  };
  const gate = capabilityGateForRun(lock, { adbDeviceCount: 0, iosImagineTabPresent: false });
  assert.equal(gate?.kind, "human-only");
  const queue = resolveGatedPlanCaptureReviewQueue([lock], { adbDeviceCount: 0 });
  assert.equal(queue.summary.planned, 1);
  assert.equal(queue.summary.blocked, 1);
  assert.match(gate?.reason ?? "", /human/u);
});

test("physical iPad dest-end is not iPhone or simulator coverage", () => {
  assert.equal(classifyIosHardware({ kind: "iPad Pro", name: "iPad Pro 10.5" }), "physical-ipad");
  assert.equal(classifyIosHardware({ kind: "iPhone 16" }), "physical-iphone");
  assert.equal(classifyIosHardware({ kind: "simulator", name: "iPad Pro" }), "simulator");
  assert.equal(classifyIosHardware({ approximation: "simulator", device: "iPhone" }), "simulator");
  assert.equal(classifyIosHardware({ name: "mystery apple" }), "unproven");
  assert.equal(iosHardwareCovers("physical-ipad", "physical-ipad"), true);
  assert.equal(iosHardwareCovers("physical-ipad", "physical-iphone"), false);
  assert.equal(iosHardwareCovers("physical-ipad", "simulator"), false);
  assert.equal(iosHardwareCovers("unproven", "physical-ipad"), false);

  const inventory = { adbDeviceCount: 0, iosImagineTabPresent: false };
  const settings = homeSlot("ios");
  settings.checkpointId = "settings";
  settings.caption = "Settings";
  assert.equal(
    capabilityGateForSlot({
      slot: settings,
      inventory,
      platform: "ios",
      observed: { iosHardwareClass: "physical-ipad" },
      device: "iPhone",
    })?.kind,
    "nonapplicable",
  );
  assert.equal(
    capabilityGateForSlot({
      slot: settings,
      inventory,
      platform: "ios",
      observed: { iosHardwareClass: "physical-ipad" },
      approximation: "simulator",
    })?.kind,
    "nonapplicable",
  );
  assert.equal(
    capabilityGateForSlot({
      slot: settings,
      inventory,
      platform: "ios",
      observed: { iosHardwareClass: "physical-ipad" },
      device: "iPad",
    }),
    undefined,
  );
  assert.match(
    capabilityGateForSlot({
      slot: settings,
      inventory,
      platform: "ios",
      observed: { iosHardwareClass: "unproven" },
      device: "iPhone",
    })?.reason ?? "",
    /unproven/u,
  );
});
