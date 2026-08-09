import assert from "node:assert/strict";
import test from "node:test";
import type { TargetProfile } from "@relay/protocol";
import { filterTargetProfiles } from "./matrix-target-filter";

const profiles: TargetProfile[] = [
  {
    id: "pixel-profile",
    targetId: "pixel",
    source: "device",
    platform: "android",
    name: "Pixel 9",
    model: "komodo",
    osVersion: "16",
    capabilities: ["tap"],
    observedAt: 1,
  },
  {
    id: "ipad-profile",
    targetId: "ipad",
    source: "device",
    platform: "ios",
    name: "iPad Pro 10.5",
    model: "iPad7,3",
    osVersion: "17.7.11",
    capabilities: ["tap"],
    observedAt: 1,
  },
];

test("device search matches names, models, OS versions, and readable platforms", () => {
  assert.deepEqual(
    filterTargetProfiles(profiles, "pixel").map((profile) => profile.targetId),
    ["pixel"],
  );
  assert.deepEqual(
    filterTargetProfiles(profiles, "ipad7").map((profile) => profile.targetId),
    ["ipad"],
  );
  assert.deepEqual(
    filterTargetProfiles(profiles, "17.7").map((profile) => profile.targetId),
    ["ipad"],
  );
  assert.deepEqual(
    filterTargetProfiles(profiles, "android").map((profile) => profile.targetId),
    ["pixel"],
  );
});

test("blank device search preserves the available target order", () => {
  assert.notEqual(filterTargetProfiles(profiles, ""), profiles);
  assert.deepEqual(filterTargetProfiles(profiles, ""), profiles);
});
