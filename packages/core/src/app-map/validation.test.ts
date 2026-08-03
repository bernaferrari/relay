import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { validateAppMap } from "./validation.js";

function emptyMap(): AppMap {
  return {
    schemaVersion: 2,
    id: "map-1",
    organizationId: "org-1",
    projectId: "project-1",
    name: "Settings demo",
    revision: 0,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
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

test("normalizes the additive groups collection for pre-release local maps", () => {
  const { groups: _groups, ...persisted } = emptyMap();
  const map = validateAppMap(persisted);

  assert.deepEqual(map.groups, {});
  assert.equal(map.name, "Settings demo");
});
