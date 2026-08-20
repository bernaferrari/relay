import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Screen } from "@relay/protocol";
import type { DeviceInfo, PersistedRun } from "./api-types.js";
import { deviceReadiness } from "./device-readiness.js";
import {
  createFirstTestStarter,
  deriveFirstTestState,
  firstTestTargetStatus,
  parseFirstTestOnboardingPreference,
  persistedRunsForFirstTest,
  serializeFirstTestOnboardingPreference,
  shouldShowFirstTestChecklist,
} from "./onboarding.js";

function mapFixture(): AppMap {
  return {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org-1",
    projectId: "project-1",
    name: "Settings",
    revision: 3,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const browser: DeviceInfo = {
  serial: "browser-1",
  id: "browser-1",
  name: "Test browser",
  platform: "browser",
  booted: true,
  connectionState: "connected",
};

function readyTarget() {
  return firstTestTargetStatus({
    online: true,
    target: browser,
    readiness: { kind: "ready" },
    hasControl: true,
  });
}

function report(input: {
  id: string;
  status?: string;
  at?: number;
  appMapId?: string;
  testId?: string;
}): PersistedRun {
  return {
    id: input.id,
    action: "app-map.test.run",
    status: input.status ?? "ok",
    attempts: 1,
    dir: ".relay/runs/test",
    frames: [],
    steps: [],
    logs: [],
    writtenAt: input.at ?? 1,
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: input.at ?? 1,
        data: {
          appMapId: input.appMapId ?? "map-1",
          test: { id: input.testId ?? "test-1" },
        },
      },
    ],
  } as PersistedRun;
}

test("onboarding preferences are versioned presentation data, not progress", () => {
  assert.deepEqual(parseFirstTestOnboardingPreference("not json"), { version: 1 });
  assert.deepEqual(parseFirstTestOnboardingPreference('{"version":2,"dismissedAt":20}'), {
    version: 1,
  });
  const preference = parseFirstTestOnboardingPreference(
    '{"version":1,"dismissedAt":10,"completedAt":20,"authoringPreference":"screen-check"}',
  );
  assert.deepEqual(preference, {
    version: 1,
    dismissedAt: 10,
    completedAt: 20,
    authoringPreference: "screen-check",
  });
  assert.deepEqual(JSON.parse(serializeFirstTestOnboardingPreference(preference)), preference);
});

test("a first capture stays blocked until Relay has a selected live frame and control", () => {
  const beforeFrame = deviceReadiness(browser, true, {
    requireLiveScreen: true,
    liveScreenAvailable: false,
  });
  assert.equal(beforeFrame.kind, "screen-preparing");
  const waitingForFrame = firstTestTargetStatus({
    online: true,
    target: browser,
    readiness: beforeFrame,
    hasControl: true,
  });
  assert.equal(waitingForFrame.kind, "needs-attention");
  if (waitingForFrame.kind !== "needs-attention") throw new Error("expected live-frame guidance");
  assert.equal(waitingForFrame.actionLabel, "Open device");

  const afterFrame = deviceReadiness(browser, true, {
    requireLiveScreen: true,
    liveScreenAvailable: true,
  });
  assert.equal(afterFrame.kind, "ready");
  assert.equal(
    firstTestTargetStatus({
      online: true,
      target: browser,
      readiness: afterFrame,
      hasControl: false,
    }).kind,
    "needs-control",
  );
  assert.equal(
    firstTestTargetStatus({
      online: true,
      target: browser,
      readiness: afterFrame,
      hasControl: true,
    }).kind,
    "ready",
  );
});

test("guide stages advance only from live target/map/Test/report facts", () => {
  const offline = firstTestTargetStatus({
    online: false,
    target: browser,
    readiness: { kind: "ready" },
    hasControl: true,
  });
  assert.equal(
    deriveFirstTestState({ target: offline, screenSaved: true, testCreated: true, testReady: true })
      .stage,
    "target",
  );
  assert.equal(
    deriveFirstTestState({
      target: readyTarget(),
      screenSaved: false,
      testCreated: false,
      testReady: false,
    }).stage,
    "capture",
  );
  assert.equal(
    deriveFirstTestState({
      target: readyTarget(),
      screenSaved: true,
      testCreated: true,
      testReady: false,
    }).stage,
    "author",
  );
  const failed = deriveFirstTestState({
    target: readyTarget(),
    screenSaved: true,
    testCreated: true,
    testReady: true,
    runs: [{ id: "failed", status: "error", writtenAt: 9 }],
  });
  assert.equal(failed.stage, "run");
  assert.equal(failed.latestRun?.id, "failed");
  const complete = deriveFirstTestState({
    target: offline,
    screenSaved: false,
    testCreated: false,
    testReady: false,
    runs: [{ id: "saved", status: "ok", writtenAt: 10 }],
  });
  assert.equal(complete.stage, "complete");
  assert.equal(complete.completedRun?.id, "saved");
});

test("the safe starter only asserts a saved stable screen and never creates a run", () => {
  const appMap = mapFixture();
  const screen: Screen = {
    id: "screen-1",
    appMapId: appMap.id,
    organizationId: appMap.organizationId,
    projectId: appMap.projectId,
    title: "Home",
    identity: { schemaVersion: 1, fingerprint: "screen-fingerprint" },
    variantIds: [],
    createdAt: 1,
    updatedAt: 2,
  };
  const starter = createFirstTestStarter({
    map: appMap,
    kind: "screen-check",
    screen,
    testId: "test-1",
    stepId: "step-1",
    at: 3,
  });
  assert.equal(starter.name, "Check Home");
  assert.equal(starter.steps.length, 1);
  assert.deepEqual(starter.steps[0], {
    id: "step-1",
    kind: "validation",
    intent: "Verify Home is visible",
    binding: {
      status: "resolved",
      kind: "assertion",
      assertion: { kind: "screen", screenId: "screen-1" },
    },
  });
  assert.deepEqual(
    createFirstTestStarter({ map: appMap, kind: "blank", testId: "blank", at: 3 }).steps,
    [],
  );
  assert.throws(
    () =>
      createFirstTestStarter({
        map: appMap,
        kind: "screen-check",
        screen: { ...screen, identity: undefined },
      }),
    /stable identity/,
  );
});

test("only exact frozen Test-plan artifacts count as persisted completion evidence", () => {
  const reports = [
    report({ id: "old", at: 2 }),
    report({ id: "new", at: 4 }),
    report({ id: "wrong-map", at: 9, appMapId: "other" }),
    report({ id: "wrong-test", at: 8, testId: "other" }),
    {
      ...report({ id: "no-plan", at: 10 }),
      artifacts: [{ kind: "other", capturedAt: 10, data: {} }],
    },
  ];
  assert.deepEqual(
    persistedRunsForFirstTest(reports, "map-1", "test-1").map((item) => item.id),
    ["new", "old"],
  );
});

test("completed handoff appears only after this guide helped author the Test", () => {
  const complete = deriveFirstTestState({
    target: readyTarget(),
    screenSaved: true,
    testCreated: true,
    testReady: true,
    runs: [{ id: "saved", status: "ok", writtenAt: 1 }],
  });
  assert.equal(shouldShowFirstTestChecklist({ version: 1 }, complete), false);
  assert.equal(
    shouldShowFirstTestChecklist({ version: 1, authoringPreference: "record" }, complete),
    true,
  );
  assert.equal(
    shouldShowFirstTestChecklist(
      { version: 1, authoringPreference: "record", completedAt: 2 },
      complete,
    ),
    false,
  );
});
