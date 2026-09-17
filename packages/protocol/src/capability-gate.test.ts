import assert from "node:assert/strict";
import test from "node:test";
import {
  canCoverPhysicalIpadSurvival,
  canCoverSignedDistribution,
  capabilityGateForRun,
  capabilityGateForSlot,
  electronGrokLabSuperGrokGate,
  claimedDeviceEffects,
  claimedDistributionCapabilities,
  classifyIosHardware,
  deviceEffectFromRecipeStep,
  distributionCapabilityMatrix,
  distributionCapabilitySupport,
  gatePlanCaptureReviewRuns,
  iosDeviceEffectMatrix,
  iosDeviceEffectSupport,
  iosHardwareCovers,
  LAB_PHYSICAL_IPAD_SERIAL,
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

test("Playwright grok-lab SuperGrok is not Electron persist:lane:grok-lab coverage", () => {
  const inventory = { adbDeviceCount: 0, electronGrokLabPartitionPresent: false };
  const playwrightRun = {
    runId: "playwright-lab",
    platform: "browser" as const,
    approximation: "browser" as const,
    observed: { laneId: "grok-lab", sessionStore: "playwright-user-data" as const },
    plannedSlots: [
      {
        checkpointId: "home",
        caption: "Home",
        attempt: 1,
        configuration: { browser: "grok-com", account: "SuperGrok" },
      },
    ],
    artifacts: [
      {
        kind: "capture-review" as const,
        data: {
          caption: "Home",
          framePath: "frames/playwright-lab.png",
          imageSha256: "pw",
          checkpointId: "home",
          configuration: { browser: "grok-com", account: "SuperGrok" },
          observed: { laneId: "grok-lab", sessionStore: "playwright-user-data" as const },
        },
      },
    ],
  };
  const playwrightQueue = resolveGatedPlanCaptureReviewQueue([playwrightRun], inventory);
  assert.equal(playwrightQueue.summary.planned, 1);
  assert.equal(playwrightQueue.summary.blocked, 0);
  assert.equal(capabilityGateForRun(playwrightRun, inventory), undefined);

  const mixed = electronGrokLabSuperGrokGate({
    inventory,
    laneId: "persist:lane:grok-lab",
    sessionStore: "playwright-user-data",
  });
  assert.equal(mixed?.kind, "nonapplicable");
  assert.match(mixed?.reason ?? "", /Playwright grok-lab SuperGrok is not Electron/u);

  const electronRun = {
    runId: "electron-lab",
    platform: "browser" as const,
    observed: { laneId: "persist:lane:grok-lab", sessionStore: "electron-partition" as const },
    plannedSlots: [
      {
        checkpointId: "home",
        caption: "Home",
        attempt: 1,
        configuration: { browser: "grok-com", account: "SuperGrok" },
      },
    ],
  };
  const electronGate = capabilityGateForRun(electronRun, inventory);
  assert.equal(electronGate?.kind, "unsupported");
  assert.match(electronGate?.reason ?? "", /persist:lane:grok-lab is absent/u);
  const electronQueue = resolveGatedPlanCaptureReviewQueue([electronRun], inventory);
  assert.equal(electronQueue.summary.planned, 1);
  assert.equal(electronQueue.summary.blocked, 1);
  assert.equal(electronQueue.summary.missing, 0);
  assert.equal(electronQueue.items[0]?.blocked, true);

  const present = capabilityGateForRun(electronRun, {
    ...inventory,
    electronGrokLabPartitionPresent: true,
  });
  assert.equal(present, undefined);
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
    serial: LAB_PHYSICAL_IPAD_SERIAL,
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
  assert.equal(queue.summary.missing, 0);
  assert.equal(queue.items[0]?.blocked, true);
  assert.match(gate?.reason ?? "", /human/u);
});

test("physical iPad dest-end is not iPhone or simulator coverage", () => {
  assert.equal(classifyIosHardware({ kind: "iPad Pro", name: "iPad Pro 10.5" }), "physical-ipad");
  assert.equal(classifyIosHardware({ serial: LAB_PHYSICAL_IPAD_SERIAL }), "physical-ipad");
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

test("airplane/lock are explicit capabilities; a Lock caption is not coverage", () => {
  assert.equal(deviceEffectFromRecipeStep({ kind: "device", action: "lock" }), "lock-screen");
  assert.equal(deviceEffectFromRecipeStep({ kind: "settings", setting: "airplane" }), "airplane");
  assert.deepEqual(
    claimedDeviceEffects({
      checkpointId: "home-chrome",
      recipeSteps: [{ kind: "wait-for" }],
    }),
    [],
  );
  const inventory = { adbDeviceCount: 0, iosImagineTabPresent: false };
  const captionOnly = {
    checkpointId: "home-chrome",
    caption: "Lock screen / airplane / wifi chrome",
    lookFor: "Wifi signal full.",
    attempt: 1,
    configuration: { app: "ai.x.GrokApp" as const },
  };
  assert.equal(
    capabilityGateForSlot({
      slot: captionOnly,
      inventory,
      platform: "ios",
      serial: LAB_PHYSICAL_IPAD_SERIAL,
    }),
    undefined,
  );
  assert.equal(
    capabilityGateForSlot({
      slot: homeSlot("ios"),
      inventory,
      platform: "ios",
      serial: LAB_PHYSICAL_IPAD_SERIAL,
      recipeSteps: [{ kind: "device", action: "lock" }],
    })?.kind,
    "human-only",
  );
});

test("this iPad serial has no lock/airplane/cellular primitive; simulator cannot cover S16", () => {
  const ipad = iosDeviceEffectMatrix({
    hardware: "physical-ipad",
    serial: LAB_PHYSICAL_IPAD_SERIAL,
  });
  assert.equal(
    ipad.every((row) => row.status !== "supported"),
    true,
  );
  assert.equal(ipad.find((row) => row.capability === "lock-screen")?.status, "human-only");
  assert.equal(ipad.find((row) => row.capability === "airplane")?.status, "human-only");
  assert.equal(ipad.find((row) => row.capability === "cellular")?.status, "unsupported");
  assert.equal(ipad.find((row) => row.capability === "external-app-auth")?.status, "human-only");
  assert.equal(
    iosDeviceEffectSupport({ hardware: "physical-iphone", capability: "cellular" }).status,
    "unsupported",
  );
  assert.equal(
    iosDeviceEffectSupport({ hardware: "simulator", capability: "airplane" }).status,
    "simulator-only",
  );
  assert.equal(
    iosDeviceEffectSupport({ hardware: "simulator", capability: "lock-screen" }).status,
    "unsupported",
  );
  assert.match(
    iosDeviceEffectSupport({ hardware: "simulator", capability: "airplane" }).primitive,
    /status_bar/u,
  );

  assert.equal(
    canCoverPhysicalIpadSurvival({
      hardware: "simulator",
      capability: "airplane",
      executionQueue: "stateful-survival",
      declaredDwellMs: 60_000,
    }).ok,
    false,
  );
  assert.equal(
    canCoverPhysicalIpadSurvival({
      hardware: "physical-ipad",
      serial: LAB_PHYSICAL_IPAD_SERIAL,
      capability: "lock-screen",
      executionQueue: "stateful-survival",
      declaredDwellMs: 60_000,
    }).ok,
    false,
  );
  const shortAirplane = canCoverPhysicalIpadSurvival({
    hardware: "physical-ipad",
    capability: "airplane",
    executionQueue: "fast-ui",
    declaredDwellMs: 10_000,
  });
  assert.equal(shortAirplane.ok, false);
  assert.match(shortAirplane.ok ? "" : shortAirplane.reason, /S16/u);

  const inventory = { adbDeviceCount: 0, iosImagineTabPresent: false };
  const simulatorAirplane = {
    runId: "sim-airplane",
    platform: "ios" as const,
    approximation: "simulator" as const,
    executionQueue: "stateful-survival" as const,
    declaredDwellMs: 60_000,
    family: SURVIVAL_FAMILY_ID,
    deviceEffects: ["airplane" as const],
    plannedSlots: [
      {
        checkpointId: "airplane",
        caption: "During airplane",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "During airplane",
          framePath: "frames/sim-airplane.png",
          imageSha256: "sim",
          checkpointId: "airplane",
          configuration: { app: "ai.x.GrokApp" },
        },
      },
    ],
  };
  const simGate = capabilityGateForRun(simulatorAirplane, inventory);
  assert.equal(simGate?.kind, "nonapplicable");
  assert.match(simGate?.reason ?? "", /simulator/u);
  const simQueue = resolveGatedPlanCaptureReviewQueue([simulatorAirplane], inventory);
  assert.equal(simQueue.items[0]?.scenarioKind, "simulator-approximation");
  assert.equal(
    canCoverPhysicalIpadSurvival({
      hardware: "simulator",
      capability: "airplane",
      executionQueue: "stateful-survival",
      declaredDwellMs: 60_000,
    }).ok,
    false,
  );

  const physicalAirplane = {
    runId: "ipad-airplane",
    platform: "ios" as const,
    serial: LAB_PHYSICAL_IPAD_SERIAL,
    plannedSlots: [
      {
        checkpointId: "airplane",
        caption: "Airplane",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
  };
  const cellular = {
    runId: "ipad-cellular",
    platform: "ios" as const,
    serial: LAB_PHYSICAL_IPAD_SERIAL,
    plannedSlots: [
      {
        checkpointId: "cellular",
        caption: "Cellular",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
  };
  const auth = {
    runId: "ipad-auth",
    platform: "ios" as const,
    serial: LAB_PHYSICAL_IPAD_SERIAL,
    deviceEffects: ["external-app-auth" as const],
    plannedSlots: [
      {
        checkpointId: "external-app-auth",
        caption: "Sign in with Google",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
  };
  const queue = resolveGatedPlanCaptureReviewQueue(
    [simulatorAirplane, physicalAirplane, cellular, auth],
    inventory,
  );
  assert.equal(queue.summary.planned, 4);
  assert.equal(queue.items.length, 4);
  assert.equal(
    queue.items.every((item) => item.runId),
    true,
  );
  const blockedUnsupported = queue.items.filter(
    (item) => item.runId !== "sim-airplane" && item.blocked,
  );
  assert.equal(blockedUnsupported.length, 3);
  assert.equal(queue.summary.missing, 0);
  assert.equal(capabilityGateForRun(physicalAirplane, inventory)?.kind, "human-only");
  assert.equal(capabilityGateForRun(cellular, inventory)?.kind, "unsupported");
  assert.equal(capabilityGateForRun(auth, inventory)?.kind, "human-only");
});

test("leftover Settings is not a signed-build claim", () => {
  assert.deepEqual(claimedDistributionCapabilities({ checkpointId: "settings" }), []);
  assert.deepEqual(
    claimedDistributionCapabilities({
      checkpointId: "home-chrome",
      distributionCapabilities: [],
    }),
    [],
  );
  const inventory = { adbDeviceCount: 0, iosImagineTabPresent: false };
  const leftoverSettings = {
    checkpointId: "settings",
    caption: "Settings",
    lookFor: "Light / Dark / System",
    attempt: 1,
    configuration: { app: "ai.x.GrokApp" as const },
  };
  assert.equal(
    capabilityGateForSlot({
      slot: leftoverSettings,
      inventory,
      platform: "ios",
      serial: LAB_PHYSICAL_IPAD_SERIAL,
    }),
    undefined,
  );
});

test("signed-build / TestFlight / production-entitlement stay blocked without a signed IPA", () => {
  const inventory = { adbDeviceCount: 0, iosImagineTabPresent: false };
  const matrix = distributionCapabilityMatrix({ inventory, platform: "ios" });
  assert.equal(
    matrix.every((row) => row.status !== "supported"),
    true,
  );
  assert.equal(matrix.find((row) => row.capability === "signed-build")?.status, "unsupported");
  assert.equal(matrix.find((row) => row.capability === "testflight")?.status, "unsupported");
  assert.equal(
    matrix.find((row) => row.capability === "production-entitlement")?.status,
    "unsupported",
  );
  assert.equal(
    canCoverSignedDistribution({ capability: "signed-build", inventory, platform: "ios" }).ok,
    false,
  );

  const signed = {
    runId: "ios-signed-build",
    platform: "ios" as const,
    serial: LAB_PHYSICAL_IPAD_SERIAL,
    plannedSlots: [
      {
        checkpointId: "signed-build",
        caption: "Signed Grok",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
  };
  const testflight = {
    runId: "ios-testflight",
    platform: "ios" as const,
    serial: LAB_PHYSICAL_IPAD_SERIAL,
    plannedSlots: [
      {
        checkpointId: "testflight",
        caption: "TestFlight",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
  };
  const entitlement = {
    runId: "ios-entitlement",
    platform: "ios" as const,
    serial: LAB_PHYSICAL_IPAD_SERIAL,
    distributionCapabilities: ["production-entitlement" as const],
    plannedSlots: [
      {
        checkpointId: "settings",
        caption: "Settings leftover",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
  };
  const simulator = {
    runId: "sim-signed-build",
    platform: "ios" as const,
    approximation: "simulator" as const,
    plannedSlots: [
      {
        checkpointId: "signed-build",
        caption: "Dev unsigned Grok",
        attempt: 1,
        configuration: { app: "ai.x.GrokApp" as const },
      },
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Dev unsigned Grok",
          framePath: "frames/sim-signed.png",
          imageSha256: "sim",
          checkpointId: "signed-build",
          configuration: { app: "ai.x.GrokApp" },
        },
      },
    ],
  };

  assert.equal(capabilityGateForRun(signed, inventory)?.kind, "unsupported");
  assert.equal(capabilityGateForRun(testflight, inventory)?.kind, "unsupported");
  assert.equal(capabilityGateForRun(entitlement, inventory)?.kind, "unsupported");
  assert.equal(capabilityGateForRun(simulator, inventory)?.kind, "nonapplicable");
  assert.equal(
    distributionCapabilitySupport({
      capability: "signed-build",
      inventory,
      approximation: "simulator",
      platform: "ios",
    }).status,
    "dev-unsigned",
  );

  const queue = resolveGatedPlanCaptureReviewQueue(
    [signed, testflight, entitlement, simulator],
    inventory,
  );
  assert.equal(queue.summary.planned, 4);
  assert.equal(queue.items.length, 4);
  assert.equal(queue.summary.missing, 0);
  assert.equal(
    queue.items.filter((item) => item.runId !== "sim-signed-build" && item.blocked).length,
    3,
  );
  assert.equal(
    queue.items.find((item) => item.runId === "sim-signed-build")?.scenarioKind,
    "simulator-approximation",
  );
  assert.match(capabilityGateForRun(signed, inventory)?.reason ?? "", /signed IPA/u);
});
