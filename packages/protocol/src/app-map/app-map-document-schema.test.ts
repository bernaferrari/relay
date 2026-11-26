import assert from "node:assert/strict";
import test from "node:test";
import { appMapDocumentSchema } from "./app-map-document-schema.js";

function minimalDocument(connection: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org-1",
    projectId: "project-1",
    name: "Map",
    revision: 1,
    screens: {},
    connections: { "connection-1": connection },
    variables: {},
    combines: {},
    tests: {},
    flows: {},
    groups: {},
    caseStacks: {},
    proposals: {},
    notes: {},
    screenVariants: {},
    routines: {},
    runs: {},
    targetResults: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function recordingConnection(recordingSource: unknown) {
  return {
    id: "connection-1",
    organizationId: "org-1",
    projectId: "project-1",
    appMapId: "map-1",
    fromScreenId: "screen-1",
    destination: { kind: "screen", screenId: "screen-2" },
    state: "ready",
    actions: [],
    recordingSource,
    createdAt: 1,
    updatedAt: 1,
  };
}

const validRecordingSource = {
  schemaVersion: 1,
  takeId: "take-1",
  takeRevision: 1,
  capture: {
    schemaVersion: 1,
    provenance: { schemaVersion: 1, mode: "control-and-record", origin: "relay-control" },
    proof: "relay-controlled",
  },
  evidenceIds: ["evidence-1"],
  frames: [{ evidenceId: "evidence-1", uri: "frame.png", role: "before" }],
};

test("connection recordingSource exact shape round-trips", () => {
  const document = minimalDocument(recordingConnection(validRecordingSource));
  const parsed = appMapDocumentSchema.parse(document);
  assert.deepEqual(parsed.connections["connection-1"]?.recordingSource, validRecordingSource);
});

test("connection recordingSource rejects obsolete partial shape", () => {
  const partial = { sessionId: "session-1", takeId: "take-1", committedAt: 1 };
  const document = minimalDocument(recordingConnection(partial));
  assert.throws(() => appMapDocumentSchema.parse(document));
  const missingProvenance = {
    ...validRecordingSource,
    capture: { schemaVersion: 1, proof: "relay-controlled" },
  };
  assert.throws(() =>
    appMapDocumentSchema.parse(minimalDocument(recordingConnection(missingProvenance))),
  );
});

test("connection presentation accepts literal route, arrow, and ports", () => {
  const connection = recordingConnection(undefined);
  const withPresentation = {
    ...connection,
    presentation: { route: "elbow", arrow: "both", sourcePort: "left", targetPort: "bottom" },
  };
  const parsed = appMapDocumentSchema.parse(minimalDocument(withPresentation));
  assert.equal(parsed.connections["connection-1"]?.presentation?.route, "elbow");
  const invalid = {
    ...connection,
    presentation: { route: "zigzag" },
  };
  assert.throws(() => appMapDocumentSchema.parse(minimalDocument(invalid)));
});
