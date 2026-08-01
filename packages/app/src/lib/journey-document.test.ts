import assert from "node:assert/strict";
import test from "node:test";
import { validateCollaborativeJourney } from "@relay/collaboration";
import type { JourneyMetadata } from "@relay/protocol";
import { createJourneyDocument } from "./journey-document";

const initial: JourneyMetadata = {
  schemaVersion: 6,
  positions: { home: { x: 40, y: 80 } },
  edgeLabels: {},
  edgeKinds: {},
  notes: [],
  takes: [],
  review: { state: "draft", updatedAt: 1 },
  graph: {
    schemaVersion: 1,
    screens: [
      {
        id: "home",
        title: "Home",
        representativeStepId: "server-step",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    transitions: [],
    flows: [],
  },
};

test("journey document uses the safe canonical schema and keeps edits reversible", () => {
  const document = createJourneyDocument(initial);
  document.replace({ ...document.read(), screenTitles: { home: "Welcome" } });

  assert.equal(document.read().screenTitles?.home, "Welcome");
  assert.equal(document.canUndo(), true);
  assert.equal(initial.screenTitles, undefined);
  assert.equal(
    validateCollaborativeJourney(document.doc, { validateServerOwnedField: () => "reject" }).ok,
    true,
  );

  document.undoOnce();
  assert.equal(document.read().screenTitles, undefined);
  assert.equal(document.canRedo(), true);

  document.redoOnce();
  assert.equal(document.read().screenTitles?.home, "Welcome");
  document.destroy();
});

test("server-owned executable metadata stays readable but never enters Yjs", () => {
  const withRecordedConnection: JourneyMetadata = {
    ...initial,
    positions: { ...initial.positions, settings: { x: 320, y: 80 } },
    graph: {
      schemaVersion: 1,
      screens: [
        ...initial.graph!.screens,
        { id: "settings", title: "Settings", createdAt: 2, updatedAt: 2 },
      ],
      transitions: [
        {
          id: "open-settings",
          fromScreenId: "home",
          destination: { kind: "screen", screenId: "settings" },
          stepIds: ["server-step"],
          evidenceIds: ["server-evidence"],
          takeId: "server-take",
          review: { status: "verified", updatedAt: 2, verifiedAt: 2 },
          state: "recorded",
          kind: "forward",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      flows: [],
    },
  };
  const document = createJourneyDocument(withRecordedConnection);
  assert.equal(document.read().graph?.screens[0]?.representativeStepId, "server-step");
  assert.deepEqual(document.read().graph?.transitions[0]?.stepIds, ["server-step"]);
  assert.deepEqual(document.read().graph?.transitions[0]?.evidenceIds, ["server-evidence"]);
  assert.equal(document.read().graph?.transitions[0]?.state, "recorded");
  assert.equal(document.read().graph?.transitions[0]?.review?.status, "verified");

  const validation = validateCollaborativeJourney(document.doc, {
    validateServerOwnedField: () => "reject",
  });
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.serverOwnedFields, []);
  document.destroy();
});

test("remote changes notify readers without joining local undo history", () => {
  const document = createJourneyDocument(initial);
  const origins: unknown[] = [];
  const unsubscribe = document.subscribe((_value, origin) => origins.push(origin));

  document.replace(
    { ...document.read(), screenTitles: { home: "Remote title" } },
    "relay:remote-test",
  );
  assert.equal(document.read().screenTitles?.home, "Remote title");
  assert.equal(document.canUndo(), false);
  assert.deepEqual(origins, ["relay:remote-test"]);

  unsubscribe();
  document.destroy();
});
