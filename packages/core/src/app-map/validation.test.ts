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

test("connection source evidence must stay inside its normalized viewport", () => {
  const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };
  const connection: Connection = {
    ...scope,
    id: "connection-source-anchor",
    createdAt: 1,
    updatedAt: 1,
    fromScreenId: "screen-a",
    destination: { kind: "screen", screenId: "screen-b" },
    state: "ready",
    actions: [],
    sourceAnchor: {
      point: { x: 0.5, y: 0.4 },
      rect: { x: 0.1, y: 0.3, width: 0.6, height: 0.08 },
    },
  };

  assert.doesNotThrow(() => assertConnection(connection, scope, "connection"));
  assert.throws(
    () =>
      assertConnection(
        { ...connection, sourceAnchor: { point: { x: 1.01, y: 0.4 } } },
        scope,
        "connection",
      ),
    /sourceAnchor\.point\.x/u,
  );
  assert.throws(
    () =>
      assertConnection(
        {
          ...connection,
          sourceAnchor: {
            point: { x: 0.5, y: 0.4 },
            rect: { x: 0.8, y: 0.3, width: 0.3, height: 0.08 },
          },
        },
        scope,
        "connection",
      ),
    /sourceAnchor\.rect must remain/u,
  );
});

test("navigation contracts reject weak-before-strong selectors and mismatched proof", () => {
  const map = emptyMap();
  const entity = {
    organizationId: "org-1",
    projectId: "project-1",
    appMapId: "map-1",
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.source = { ...entity, id: "source", title: "Ask", variantIds: [] };
  map.screens.settings = {
    ...entity,
    id: "settings",
    title: "Settings",
    identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    variantIds: [],
  };
  map.connections.open = {
    ...entity,
    id: "open",
    fromScreenId: "source",
    destination: { kind: "screen", screenId: "settings" },
    state: "ready",
    actions: [],
    navigation: {
      targetAlternatives: [
        { kind: "accessibility", label: "Settings", role: "button" },
        { kind: "identifier", identifier: "settings_button" },
      ],
      expectedDestination: {
        screenId: "source",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        evidenceIds: ["destination-tree"],
      },
    },
  };

  assert.throws(() => validateAppMap(map), /identifier, accessibility/u);
  map.connections.open.navigation!.targetAlternatives.reverse();
  assert.throws(() => validateAppMap(map), /proof does not match its destination/u);
});
