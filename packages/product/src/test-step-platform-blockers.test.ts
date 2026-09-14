import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { testStepPlatformBlockers } from "./test-step-platform-blockers.js";

const androidOfflineTest: Pick<AppMapScenarioTest, "steps"> = {
  steps: [
    {
      id: "browser-offline",
      kind: "instruction",
      intent: "Toggle browser offline on then off",
      binding: {
        status: "resolved",
        kind: "connections",
        connectionIds: ["connection-android-browser-offline"],
      },
    },
  ],
};

const androidMap = {
  connections: {
    "connection-android-browser-offline": {
      actions: [
        {
          kind: "steps",
          steps: [
            { kind: "wait-for", target: { label: "Google search" } },
            { kind: "offline", state: "on" },
            { kind: "offline", state: "off" },
          ],
        },
      ],
    } as AppMap["connections"][string],
  },
};

test("Android recorded offline is a compile-block, not a Ready step", () => {
  const blockers = testStepPlatformBlockers(androidOfflineTest, androidMap, ["android"]);
  assert.equal(blockers["browser-offline"], "offline is a browser step");
});

test("browser recorded offline is not a compile-block", () => {
  const blockers = testStepPlatformBlockers(androidOfflineTest, androidMap, ["browser"]);
  assert.deepEqual(blockers, {});
});

test("mixed recorded platforms do not block when one route can run", () => {
  const blockers = testStepPlatformBlockers(androidOfflineTest, androidMap, ["android", "browser"]);
  assert.deepEqual(blockers, {});
});
