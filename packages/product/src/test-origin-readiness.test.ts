import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { scenarioTestOriginMissingEvidence } from "./test-origin-readiness.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "grok-ios" };

function shareMenu(): AppMapScenarioTest {
  return {
    ...scope,
    id: "test-grok-ios-share-menu",
    name: "Share Conversation and Delete menu",
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: "ai.x.GrokApp",
    steps: [
      {
        id: "step-action",
        kind: "instruction",
        intent: "Share Conversation and Delete menu",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["connection-grok-ios-share-menu"],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

test("share-menu is origin-missing when signed-in home has no variant", () => {
  const map = {
    screens: {
      "screen-grok-ios-signed-in-home": {
        ...scope,
        id: "screen-grok-ios-signed-in-home",
        title: "Signed-in SuperGrok home",
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    screenVariants: {},
    connections: {
      "connection-grok-ios-share-menu": {
        ...scope,
        id: "connection-grok-ios-share-menu",
        fromScreenId: "screen-grok-ios-signed-in-home",
        destination: { kind: "end" },
        label: "Share and delete menu",
        state: "ready",
        actions: [],
        createdAt: at,
        updatedAt: at,
      },
    },
  } as Pick<AppMap, "screens" | "screenVariants" | "connections">;
  const missing = scenarioTestOriginMissingEvidence(map, shareMenu());
  assert.equal(missing?.screenId, "screen-grok-ios-signed-in-home");
  assert.match(missing?.title ?? "", /Signed-in SuperGrok home/u);
});

test("an origin variant with observation is not missing evidence", () => {
  const map = {
    screens: {
      home: {
        ...scope,
        id: "home",
        title: "Home",
        variantIds: ["home-ios"],
        createdAt: at,
        updatedAt: at,
      },
    },
    screenVariants: {
      "home-ios": {
        ...scope,
        id: "home-ios",
        screenId: "home",
        targetProfile: {
          id: "ipad",
          targetId: "ipad-1",
          source: "device",
          platform: "ios",
          name: "iPad",
          capabilities: ["screenshot"],
          observedAt: at,
        },
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      },
    },
    connections: {
      chrome: {
        ...scope,
        id: "chrome",
        fromScreenId: "home",
        destination: { kind: "end" },
        label: "Home",
        state: "ready",
        actions: [],
        createdAt: at,
        updatedAt: at,
      },
    },
  } as Pick<AppMap, "screens" | "screenVariants" | "connections">;
  const test = shareMenu();
  test.steps[0]!.binding = {
    status: "resolved",
    kind: "connections",
    connectionIds: ["chrome"],
  };
  assert.equal(scenarioTestOriginMissingEvidence(map, test), undefined);
});
