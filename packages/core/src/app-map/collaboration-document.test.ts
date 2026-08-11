import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import {
  appMapToCollaborationDocument,
  collaborationChangesToBatchChanges,
} from "./collaboration-document.js";
import { commitAppMapChanges } from "./batch-operations.js";

function map(): AppMap {
  return {
    schemaVersion: 1,
    id: "settings",
    organizationId: "acme",
    projectId: "mobile",
    name: "Settings",
    revision: 0,
    notes: {},
    groups: {},
    screens: {
      home: {
        id: "home",
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "settings",
        title: "Home",
        variantIds: [],
        createdAt: 10,
        updatedAt: 10,
      },
      "settings-screen": {
        id: "settings-screen",
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "settings",
        title: "Settings",
        variantIds: [],
        createdAt: 10,
        updatedAt: 10,
      },
    },
    screenVariants: {},
    connections: {
      "open-settings": {
        id: "open-settings",
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings-screen" },
        state: "draft",
        actions: [],
        presentation: { route: "curve", arrow: "end" },
        createdAt: 10,
        updatedAt: 10,
      },
    },
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
    createdAt: 10,
    updatedAt: 10,
  };
}

test("the collaboration document contains only stable-id authoring entities", () => {
  const document = appMapToCollaborationDocument(map());

  assert.equal(document.format, "relay.app-map-authoring");
  assert.deepEqual(document.entities.screenLayouts.home?.position, null);
  assert.equal(
    document.entities.connectionPresentations["open-settings"]?.presentation?.route,
    "curve",
  );
  assert.equal("runs" in document.entities, false);
  assert.equal("targetResults" in document.entities, false);
  assert.equal("activity" in document.entities, false);
});

test("a collaboration transaction becomes narrow server-validated App Map changes", () => {
  const current = map();
  const changes = collaborationChangesToBatchChanges(
    current,
    [
      {
        kind: "note.save",
        id: "note",
        text: "Review language flow",
        position: { x: 40, y: 80 },
      },
      {
        kind: "screen.layout",
        screenId: "home",
        position: { x: 160, y: 80 },
      },
      {
        kind: "connection.presentation",
        connectionId: "open-settings",
        patch: { route: "straight", arrow: "both" },
      },
    ],
    20,
  );

  assert.deepEqual(
    changes.map((change) => change.kind),
    ["note.save", "screen.update", "connection.update"],
  );
  assert.equal(changes[0]?.kind === "note.save" && changes[0].note.updatedAt, 20);
  assert.equal(changes[1]?.kind === "screen.update" && changes[1].input.patch.position?.x, 160);
  assert.equal(
    changes[2]?.kind === "connection.update" && changes[2].patch.presentation?.arrow,
    "both",
  );
});

test("a collaboration presentation patch preserves independently edited fields", () => {
  const changes = collaborationChangesToBatchChanges(
    map(),
    [
      {
        kind: "connection.presentation",
        connectionId: "open-settings",
        patch: { arrow: "both" },
      },
    ],
    20,
  );

  assert.deepEqual(
    changes[0]?.kind === "connection.update" ? changes[0].patch.presentation : undefined,
    { route: "curve", arrow: "both" },
  );
});

test("first-class note changes are one atomic App Map commit", () => {
  const result = commitAppMapChanges(
    map(),
    [
      {
        kind: "note.save",
        note: {
          id: "note",
          organizationId: "acme",
          projectId: "mobile",
          appMapId: "settings",
          text: "Review language flow",
          position: { x: 40, y: 80 },
          createdAt: 12,
          updatedAt: 12,
        },
      },
    ],
    undefined,
    {
      expectedRevision: 0,
      eventId: "save-note",
      actorId: "human:alex",
      actorKind: "human",
      at: 12,
    },
    "Added a note",
  );

  assert.equal(result.revision, 1);
  assert.equal(result.notes.note?.position.x, 40);
  assert.equal(result.activity["save-note"]?.summary, "Added a note");
});

test("collaboration transactions reject invalid server timestamps", () => {
  assert.throws(
    () => collaborationChangesToBatchChanges(map(), [], Number.NaN),
    /timestamp is invalid/u,
  );
});
