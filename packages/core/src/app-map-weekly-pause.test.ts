import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "grok-web" };

test("weekly Continue-with-X pauses compile without inventing native Grok Settings routes", () => {
  const map: AppMap = {
    schemaVersion: 1,
    id: "grok-web",
    organizationId: "org",
    projectId: "project",
    name: "Grok.com daily",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      home: {
        ...scope,
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
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
    createdAt: at,
    updatedAt: at,
  };
  const weekly: AppMapScenarioTest = {
    ...scope,
    id: "test-grok-web-weekly",
    name: "Grok.com weekly manual",
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: "https://grok.com",
    steps: [
      {
        id: "continue-with-x",
        kind: "manual",
        intent: "Continue with X, Google, or Apple",
        binding: {
          status: "resolved",
          kind: "pause",
          message: "Continue with X / Google / Apple on this account, then resume.",
          reason: "authentication",
          resumeLabel: "Signed in",
        },
      },
      {
        id: "dictation",
        kind: "manual",
        intent: "Use dictation on the composer",
        binding: {
          status: "resolved",
          kind: "pause",
          message: "Use dictation on the composer, then resume.",
          reason: "review",
          resumeLabel: "Dictation done",
        },
      },
      {
        id: "camera",
        kind: "manual",
        intent: "Capture one photo from the camera sheet",
        binding: {
          status: "resolved",
          kind: "pause",
          message: "Open the camera or attachment sheet, capture one photo, then resume.",
          reason: "permission",
          resumeLabel: "Camera done",
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const compiled = compileAppMapTest(map, weekly);
  const pauses = compiled.root.steps.filter((step) => step.kind === "pause");
  assert.equal(pauses.length, 3);
  assert.equal(pauses[0]?.reason, "authentication");
  assert.equal(pauses[1]?.reason, "review");
  assert.equal(pauses[2]?.reason, "permission");
  const android = compileAppMapTest(map, weekly, {
    runtimeTargetProfile: {
      id: "pixel",
      targetId: "pixel-1",
      platform: "android",
    },
  });
  assert.equal(android.root.steps.filter((step) => step.kind === "pause").length, 0);
  assert.equal(android.plan.omittedSteps?.length, 3);
  assert.match(android.plan.omittedSteps?.[0]?.reason ?? "", /Grok Settings/u);
});
