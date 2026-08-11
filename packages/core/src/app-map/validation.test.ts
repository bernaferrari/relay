import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Connection } from "@relay/protocol";
import { validateAppMap } from "./validation.js";
import { assertConnection } from "./validation-shapes.js";

function emptyMap(): AppMap {
  return {
    schemaVersion: 1,
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

test("normalizes the additive groups collection for pre-release local maps", () => {
  const { groups: _groups, ...persisted } = emptyMap();
  const map = validateAppMap(persisted);

  assert.deepEqual(map.groups, {});
  assert.equal(map.name, "Settings demo");
});

test("connector presentation accepts explicit arrowheads at either endpoint", () => {
  const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };
  const connection: Connection = {
    ...scope,
    id: "connection-1",
    createdAt: 1,
    updatedAt: 1,
    fromScreenId: "screen-a",
    destination: { kind: "screen", screenId: "screen-b" },
    state: "draft",
    actions: [],
    presentation: { arrow: "both", route: "curve" },
  };

  assert.doesNotThrow(() => assertConnection(connection, scope, "connection"));
});
