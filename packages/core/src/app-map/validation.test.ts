import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapVariable, Connection } from "@relay/protocol";
import { validateAppMap } from "./validation.js";
import { assertAppMapVariable, assertConnection } from "./validation-shapes.js";

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

test("keeps variable navigation validation available from validation-shapes", () => {
  const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };
  const variable: AppMapVariable = {
    ...scope,
    id: "language",
    name: "Language",
    kind: "language",
    apply: {
      kind: "list",
      entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      pickerPath: [{ kind: "scroll", direction: "down" }],
      exitPath: [{ kind: "back" }],
    },
    options: [
      { id: "en", label: "English" },
      { id: "pt-BR", label: "Português (Brasil)" },
    ],
    restoreId: "en",
    createdAt: 1,
    updatedAt: 1,
  };

  assert.doesNotThrow(() => assertAppMapVariable(variable, scope, "variable"));
  assert.throws(
    () =>
      assertAppMapVariable(
        {
          ...variable,
          apply: { kind: "list", pickerPath: [{ kind: "tap", target: {} }] },
        },
        scope,
        "variable",
      ),
    /variable\.apply\.pickerPath\[0\]\.target needs identifier, label, or text/u,
  );
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

test("recording provenance requires one exact recorded action evidence set", () => {
  const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };
  const recordingSource = {
    schemaVersion: 1 as const,
    takeId: "take-1",
    takeRevision: 1,
    capture: {
      schemaVersion: 1 as const,
      provenance: {
        schemaVersion: 1 as const,
        mode: "control-and-record" as const,
        origin: "relay-control" as const,
      },
      proof: "relay-controlled" as const,
    },
    evidenceIds: ["evidence-a", "evidence-b"],
  };
  const connection: Connection = {
    ...scope,
    id: "connection-recorded",
    createdAt: 1,
    updatedAt: 1,
    fromScreenId: "screen-a",
    destination: { kind: "screen", screenId: "screen-b" },
    state: "ready",
    actions: [],
    recordingSource,
  };

  assert.throws(
    () => assertConnection(connection, scope, "connection"),
    /recordingSource must match its recorded action evidence/u,
  );
  const recorded = {
    id: "recorded-1",
    kind: "recorded" as const,
    takeId: "take-1",
    takeRevision: 1,
    steps: [{ id: "step-1", kind: "sleep" as const, ms: 1 }],
    evidenceIds: ["evidence-b", "evidence-a"],
  };
  assert.doesNotThrow(() =>
    assertConnection({ ...connection, actions: [recorded] }, scope, "connection"),
  );
  assert.throws(
    () =>
      assertConnection(
        {
          ...connection,
          actions: [recorded],
          recordingSource: { ...recordingSource, evidenceIds: ["evidence-a", "evidence-c"] },
        },
        scope,
        "connection",
      ),
    /recordingSource must match its recorded action evidence/u,
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
  map.screens.source = {
    ...entity,
    id: "source",
    title: "Ask",
    identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
    variantIds: [],
  };
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

test("return contracts freeze the exact approved origin proof", () => {
  const map = emptyMap();
  const entity = {
    organizationId: "org-1",
    projectId: "project-1",
    appMapId: "map-1",
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.settings = {
    ...entity,
    id: "settings",
    title: "Settings",
    identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    variantIds: [],
  };
  map.screens.widget = {
    ...entity,
    id: "widget",
    title: "Widget",
    identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
    variantIds: [],
  };
  map.connections.widget = {
    ...entity,
    id: "widget",
    fromScreenId: "settings",
    destination: { kind: "screen", screenId: "widget" },
    state: "ready",
    actions: [{ id: "tap-widget", kind: "tap", target: { label: "Widget" } }],
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "settings",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        evidenceIds: ["settings-return-tree"],
      },
      expectedApp: "ai.x.grok",
    },
  };

  assert.doesNotThrow(() => validateAppMap(map));
  map.connections.widget.return!.expectedDestination.screenId = "widget";
  assert.throws(() => validateAppMap(map), /return proof does not match its origin/u);
  map.connections.widget.return!.expectedDestination.screenId = "settings";
  map.connections.widget.return!.expectedDestination.identity.fingerprint = "c".repeat(64);
  assert.throws(() => validateAppMap(map), /return proof is not an approved origin identity/u);
});
