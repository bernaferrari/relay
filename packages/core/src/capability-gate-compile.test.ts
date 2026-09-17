import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapEntity, AppMapScenarioTest, Connection, Screen } from "@relay/protocol";
import {
  canCoverSignedDistribution,
  capabilityGateForRun,
  claimedDistributionCapabilities,
  resolveGatedPlanCaptureReviewQueue,
} from "@relay/protocol";
import { AppMapTestCompileError } from "./app-map-test-compile-error.js";
import { compileAppMapTest } from "./map-work.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "grok-android" };

function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}

function screen(id: string): Screen {
  return {
    ...entity(id),
    title: id,
    identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    variantIds: [],
  };
}

function homeConnection(): Connection {
  return {
    ...entity("open-home-chrome"),
    fromScreenId: "home",
    destination: { kind: "end" },
    label: "Home chrome",
    state: "ready",
    actions: [
      {
        id: "home-chrome",
        kind: "steps",
        steps: [{ kind: "wait-for", target: { identifier: "composer" }, timeoutMs: 8_000 }],
      },
    ],
  };
}

function homeTest(): AppMapScenarioTest {
  return {
    ...entity("test-grok-android-home-chrome"),
    name: "Home chrome",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open-home-chrome",
        kind: "instruction",
        intent: "Home",
        capture: true,
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-home-chrome"],
        },
      },
    ],
  };
}

function imagineTest(): AppMapScenarioTest {
  return {
    ...entity("test-grok-ios-imagine"),
    name: "Imagine",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open-imagine",
        kind: "instruction",
        intent: "Open Imagine",
        binding: {
          status: "unresolved",
          reason: "navigation.tab.imagine absent. Do not invent the tab.",
        },
      },
    ],
  };
}

function map(tests: Record<string, AppMapScenarioTest>): AppMap {
  return {
    schemaVersion: 1,
    id: "grok-android",
    organizationId: "org",
    projectId: "project",
    name: "Grok Android",
    revision: 1,
    notes: {},
    groups: {},
    screens: { home: screen("home") },
    screenVariants: {},
    connections: { "open-home-chrome": homeConnection() },
    caseStacks: {},
    variables: {},
    tests,
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("compiled Android Home plannedSlot stays blocked when adb is empty", () => {
  const compiled = compileAppMapTest(
    map({ "test-grok-android-home-chrome": homeTest() }),
    homeTest(),
  );
  const planned = (compiled.plan.plannedSlots ?? []).map((slot) => ({
    ...slot,
    configuration: { app: "android" as const },
  }));
  assert.ok(planned.length >= 1);
  const queue = resolveGatedPlanCaptureReviewQueue(
    [
      {
        runId: "android-home",
        platform: "android",
        plannedSlots: planned,
      },
    ],
    { adbDeviceCount: 0 },
  );
  assert.equal(queue.summary.planned, planned.length);
  assert.equal(queue.summary.blocked, planned.length);
  assert.equal(queue.summary.missing, 0);
  assert.equal(
    queue.items.every((item) => item.blocked && item.status === "missing"),
    true,
  );
  assert.equal(queue.items[0]?.configuration?.app, "android");
});

test("iOS Imagine compile unresolved-step does not invent navigation.tab.imagine", () => {
  assert.throws(
    () => compileAppMapTest(map({ "test-grok-ios-imagine": imagineTest() }), imagineTest()),
    (error: unknown) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unresolved-step" &&
      /navigation\.tab\.imagine absent/u.test(error.message),
  );
});

test("compiled leftover Settings is not signed-build coverage without a signed IPA", () => {
  const compiled = compileAppMapTest(
    map({ "test-grok-android-home-chrome": homeTest() }),
    homeTest(),
  );
  const leftover = (compiled.plan.plannedSlots ?? []).map((slot) => ({
    ...slot,
    checkpointId: "settings",
    caption: "Settings leftover",
    configuration: { app: "ai.x.GrokApp" as const },
  }));
  assert.ok(leftover.length >= 1);
  assert.deepEqual(
    claimedDistributionCapabilities({ checkpointId: leftover[0]?.checkpointId }),
    [],
  );
  const inventory = { adbDeviceCount: 0, iosImagineTabPresent: false };
  assert.equal(
    canCoverSignedDistribution({
      capability: "signed-build",
      inventory,
      platform: "ios",
    }).ok,
    false,
  );
  const leftoverQueue = resolveGatedPlanCaptureReviewQueue(
    [
      {
        runId: "ipad-settings",
        platform: "ios",
        serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
        plannedSlots: leftover,
      },
    ],
    inventory,
  );
  assert.equal(leftoverQueue.summary.blocked, 0);

  const signedQueue = resolveGatedPlanCaptureReviewQueue(
    [
      {
        runId: "ios-signed-build",
        platform: "ios",
        serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
        plannedSlots: leftover.map((slot) => ({ ...slot, checkpointId: "signed-build" })),
      },
    ],
    inventory,
  );
  assert.equal(signedQueue.summary.planned, leftover.length);
  assert.equal(signedQueue.summary.blocked, leftover.length);
  assert.equal(signedQueue.summary.missing, 0);
});

test("compiled Playwright grok-lab SuperGrok is not Electron persist:lane coverage", () => {
  const compiled = compileAppMapTest(
    map({ "test-grok-android-home-chrome": homeTest() }),
    homeTest(),
  );
  const planned = (compiled.plan.plannedSlots ?? []).map((slot) => ({
    ...slot,
    configuration: { browser: "grok-com" as const, account: "SuperGrok" },
  }));
  assert.ok(planned.length >= 1);
  const inventory = { adbDeviceCount: 0, electronGrokLabPartitionPresent: false };
  const playwrightQueue = resolveGatedPlanCaptureReviewQueue(
    [
      {
        runId: "playwright-lab",
        platform: "browser",
        observed: { laneId: "grok-lab", sessionStore: "playwright-user-data" },
        plannedSlots: planned,
      },
    ],
    inventory,
  );
  assert.equal(playwrightQueue.summary.blocked, 0);

  const electronRun = {
    runId: "electron-lab",
    platform: "browser" as const,
    observed: { laneId: "persist:lane:grok-lab", sessionStore: "electron-partition" as const },
    plannedSlots: planned,
  };
  assert.equal(capabilityGateForRun(electronRun, inventory)?.kind, "unsupported");
  const electronQueue = resolveGatedPlanCaptureReviewQueue([electronRun], inventory);
  assert.equal(electronQueue.summary.planned, planned.length);
  assert.equal(electronQueue.summary.blocked, planned.length);
  assert.equal(electronQueue.summary.missing, 0);
});
