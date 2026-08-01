import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyMetadata } from "@relay/protocol";
import * as Y from "yjs";
import {
  COLLABORATIVE_JOURNEY_DRAFT_KEYS,
  COLLABORATIVE_JOURNEY_ORDER_FIELD,
  COLLABORATIVE_JOURNEY_ROOT_KEYS,
  CollaborativeJourneyValidationError,
  applyCollaborativeJourneyUpdate,
  createCollaborativeJourneyDoc,
  createCollaborativeJourneyUndoManager,
  encodeCollaborativeJourneyStateVector,
  encodeCollaborativeJourneyUpdate,
  getCollaborativeJourneyEntityMap,
  getCollaborativeJourneyRoot,
  materializeCollaborativeJourney,
  reconcileCollaborativeJourney,
  validateCollaborativeJourney,
} from "./index.js";

const metadata = (): JourneyMetadata => ({
  schemaVersion: 6,
  positions: {
    home: { x: 20, y: 40 },
    settings: { x: 320, y: 40 },
    archive: { x: 620, y: 40 },
  },
  screenTitles: { home: "Legacy home" },
  edgeLabels: { "open-settings": "Open settings" },
  edgeKinds: { "open-settings": "forward" },
  notes: [
    { id: "note-review", text: "Check empty state", x: 80, y: 260, createdAt: 1, updatedAt: 1 },
  ],
  graph: {
    schemaVersion: 1,
    screens: [
      {
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "screen:home", aliases: ["screen:start"] },
        observations: [
          {
            id: "observation-home",
            fingerprint: "screen:home",
            capturedAt: 1,
            source: "manual",
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      { id: "settings", title: "Settings", createdAt: 1, updatedAt: 1 },
      { id: "archive", title: "Archive", createdAt: 1, updatedAt: 1 },
    ],
    transitions: [
      {
        id: "open-settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        stepIds: [],
        label: "Open settings",
        state: "needs-recording",
        kind: "forward",
        provenance: { source: "manual" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "open-archive",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "archive" },
        stepIds: [],
        state: "needs-recording",
        kind: "forward",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    flows: [{ id: "main", name: "Main flow", screenId: "home", createdAt: 1, updatedAt: 1 }],
  },
});

function entity(fields: Record<string, unknown>, order: number): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(COLLABORATIVE_JOURNEY_ORDER_FIELD, order);
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Y.AbstractType) map.set(key, value);
    else map.set(key, value);
  }
  return map;
}

function nested(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

test("bootstrap/export round-trips canonical screens, connections, layout, notes, and draft labels", () => {
  const initial = metadata();
  const doc = createCollaborativeJourneyDoc(initial);

  assert.deepEqual(materializeCollaborativeJourney(doc), initial);
  assert.equal(getCollaborativeJourneyRoot(doc).has("takes"), false);
  assert.equal(getCollaborativeJourneyRoot(doc).has("review"), false);
  assert.equal(getCollaborativeJourneyRoot(doc).has("prototype"), false);
  doc.destroy();
});

test("two documents converge after concurrent move, rename, add, delete, and connection edits", () => {
  const left = createCollaborativeJourneyDoc(metadata());
  const right = new Y.Doc();
  applyCollaborativeJourneyUpdate(right, encodeCollaborativeJourneyUpdate(left), "initial-sync");
  const leftVector = encodeCollaborativeJourneyStateVector(left);
  const rightVector = encodeCollaborativeJourneyStateVector(right);

  left.transact(() => {
    const positions = getCollaborativeJourneyEntityMap(
      left,
      COLLABORATIVE_JOURNEY_ROOT_KEYS.positions,
    );
    positions.get("home")!.set("x", 180);
    positions.get("home")!.set("y", 120);
    getCollaborativeJourneyEntityMap(left, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get("home")!
      .set("title", "Dashboard");
    getCollaborativeJourneyEntityMap(left, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens).set(
      "checkout",
      entity({ title: "Checkout", createdAt: 2, updatedAt: 2 }, 3),
    );
    positions.set("checkout", nested({ x: 920, y: 40 }));
    getCollaborativeJourneyEntityMap(left, COLLABORATIVE_JOURNEY_ROOT_KEYS.connections).set(
      "open-checkout",
      entity(
        {
          fromScreenId: "settings",
          destination: nested({ kind: "screen", screenId: "checkout" }),
          stepIds: new Y.Array<string>(),
          label: "Checkout",
          state: "needs-recording",
          kind: "forward",
          createdAt: 2,
          updatedAt: 2,
        },
        2,
      ),
    );
  }, "left-local");

  right.transact(() => {
    const positions = getCollaborativeJourneyEntityMap(
      right,
      COLLABORATIVE_JOURNEY_ROOT_KEYS.positions,
    );
    positions.get("home")!.set("x", 200);
    positions.get("home")!.set("y", 140);
    getCollaborativeJourneyEntityMap(right, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get("settings")!
      .set("title", "Preferences");
    getCollaborativeJourneyEntityMap(right, COLLABORATIVE_JOURNEY_ROOT_KEYS.connections)
      .get("open-settings")!
      .set("label", "Configure");
    getCollaborativeJourneyEntityMap(right, COLLABORATIVE_JOURNEY_ROOT_KEYS.connections).delete(
      "open-archive",
    );
    getCollaborativeJourneyEntityMap(right, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens).delete(
      "archive",
    );
    positions.delete("archive");
  }, "right-local");

  const leftUpdate = encodeCollaborativeJourneyUpdate(left, rightVector);
  const rightUpdate = encodeCollaborativeJourneyUpdate(right, leftVector);
  applyCollaborativeJourneyUpdate(left, rightUpdate, "right-remote");
  applyCollaborativeJourneyUpdate(right, leftUpdate, "left-remote");

  const leftValue = materializeCollaborativeJourney(left);
  const rightValue = materializeCollaborativeJourney(right);
  assert.deepEqual(leftValue, rightValue);
  assert.equal(
    leftValue.graph?.screens.some((screen) => screen.id === "checkout"),
    true,
  );
  assert.equal(
    leftValue.graph?.screens.some((screen) => screen.id === "archive"),
    false,
  );
  assert.equal(
    leftValue.graph?.transitions.find((connection) => connection.id === "open-settings")?.label,
    "Configure",
  );
  assert.equal(
    leftValue.graph?.transitions.some((connection) => connection.id === "open-archive"),
    false,
  );
  assert.match(
    leftValue.graph?.screens.find((screen) => screen.id === "home")?.title ?? "",
    /Dashboard/,
  );
  assert.equal(
    leftValue.graph?.screens.find((screen) => screen.id === "settings")?.title,
    "Preferences",
  );
  assert.deepEqual(encodeCollaborativeJourneyUpdate(left), encodeCollaborativeJourneyUpdate(right));
  left.destroy();
  right.destroy();
});

test("deterministic materialization uses explicit order and stable ID tie-breaking", () => {
  const doc = createCollaborativeJourneyDoc(metadata());
  const screens = getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens);
  doc.transact(() => {
    screens.get("archive")!.set(COLLABORATIVE_JOURNEY_ORDER_FIELD, 10);
    screens.get("settings")!.set(COLLABORATIVE_JOURNEY_ORDER_FIELD, 10);
  });

  const first = JSON.stringify(materializeCollaborativeJourney(doc));
  const second = JSON.stringify(materializeCollaborativeJourney(doc));
  assert.equal(first, second);
  assert.deepEqual(
    materializeCollaborativeJourney(doc).graph?.screens.map((screen) => screen.id),
    ["home", "archive", "settings"],
  );
  doc.destroy();
});

test("a local UndoManager does not undo updates applied with a remote origin", () => {
  const local = createCollaborativeJourneyDoc(metadata());
  const remote = new Y.Doc();
  applyCollaborativeJourneyUpdate(remote, encodeCollaborativeJourneyUpdate(local), "initial-sync");
  const localOrigin = Symbol("local-origin");
  const undo = createCollaborativeJourneyUndoManager(local, localOrigin, 0);

  local.transact(() => {
    getCollaborativeJourneyEntityMap(local, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get("home")!
      .set("title", "Local title");
  }, localOrigin);
  remote.transact(() => {
    getCollaborativeJourneyEntityMap(remote, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get("settings")!
      .set("title", "Remote title");
  }, "remote-local");
  applyCollaborativeJourneyUpdate(local, encodeCollaborativeJourneyUpdate(remote), "remote-origin");

  undo.undo();
  const value = materializeCollaborativeJourney(local);
  assert.equal(value.graph?.screens.find((screen) => screen.id === "home")?.title, "Home");
  assert.equal(
    value.graph?.screens.find((screen) => screen.id === "settings")?.title,
    "Remote title",
  );
  undo.destroy();
  local.destroy();
  remote.destroy();
});

test("forged executable metadata is stripped by default and rejectable by the server hook", () => {
  const initial = metadata();
  initial.takes = [
    {
      id: "take-forbidden",
      recipeId: "recipe",
      startedAt: 1,
      group: "take",
      state: "review",
      steps: [{ id: "forged-step", kind: "key", key: "back" }],
    },
  ];
  initial.review = { state: "approved", updatedAt: 1, approvedAt: 1 };
  const doc = createCollaborativeJourneyDoc(initial);
  const connection = getCollaborativeJourneyEntityMap(
    doc,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.connections,
  ).get("open-settings")!;
  doc.transact(() => {
    const stepIds = new Y.Array<string>();
    stepIds.push(["forged-step"]);
    const evidenceIds = new Y.Array<string>();
    evidenceIds.push(["forged-evidence"]);
    connection.set("stepIds", stepIds);
    connection.set("evidenceIds", evidenceIds);
    connection.set("review", nested({ status: "verified", updatedAt: 10, verifiedAt: 10 }));
    connection.set("state", "recorded");
  }, "untrusted-direct-edit");

  const strippedResult = validateCollaborativeJourney(doc);
  assert.equal(strippedResult.ok, true);
  assert.deepEqual(
    strippedResult.serverOwnedFields.map((field) => [field.path, field.decision]),
    [
      ["connections.open-settings.stepIds", "strip"],
      ["connections.open-settings.evidenceIds", "strip"],
      ["connections.open-settings.review", "strip"],
      ["connections.open-settings.state", "strip"],
    ],
  );
  const stripped = materializeCollaborativeJourney(doc);
  const exported = stripped.graph?.transitions.find(
    (candidate) => candidate.id === "open-settings",
  );
  assert.deepEqual(exported?.stepIds, []);
  assert.equal(exported?.evidenceIds, undefined);
  assert.equal(exported?.review, undefined);
  assert.equal(exported?.state, "needs-recording");
  assert.equal(stripped.takes, undefined);
  assert.equal(stripped.review, undefined);

  const rejected = validateCollaborativeJourney(doc, {
    validateServerOwnedField: () => "reject",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.issues.filter((entry) => entry.code === "server-owned-field").length, 4);
  assert.throws(
    () =>
      materializeCollaborativeJourney(doc, {
        validateServerOwnedField: () => "reject",
      }),
    CollaborativeJourneyValidationError,
  );
  doc.destroy();
});

test("bootstrap and materialization reject duplicate IDs, dangling references, and unknown roots", () => {
  const duplicate = metadata();
  duplicate.graph!.screens.push({ ...duplicate.graph!.screens[0]! });
  assert.throws(() => createCollaborativeJourneyDoc(duplicate), /duplicate id home/);

  const doc = createCollaborativeJourneyDoc(metadata());
  getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.flows)
    .get("main")!
    .set("screenId", "missing-screen");
  getCollaborativeJourneyRoot(doc).set("runs", new Y.Map());
  const result = validateCollaborativeJourney(doc);
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((entry) => entry.code === "dangling-reference"),
    true,
  );
  assert.equal(
    result.issues.some((entry) => entry.path === "runs"),
    true,
  );
  doc.destroy();
});

test("reconciliation preserves retained map identities and applies the supplied origin", () => {
  const doc = createCollaborativeJourneyDoc(metadata());
  const origin = Symbol("app-local-projection");
  const root = getCollaborativeJourneyRoot(doc);
  const screens = getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens);
  const home = screens.get("home")!;
  const identity = home.get("identity");
  const observations = home.get("observations");
  assert.ok(observations instanceof Y.Array);
  const observation = observations.get(0);
  assert.ok(observation instanceof Y.Map);
  const connections = getCollaborativeJourneyEntityMap(
    doc,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.connections,
  );
  const openSettings = connections.get("open-settings")!;
  const destination = openSettings.get("destination");
  assert.ok(destination instanceof Y.Map);
  const positions = getCollaborativeJourneyEntityMap(
    doc,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.positions,
  );
  const homePosition = positions.get("home")!;
  const notes = getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.notes);
  const note = notes.get("note-review")!;
  const draft = root.get(COLLABORATIVE_JOURNEY_ROOT_KEYS.draft);
  assert.ok(draft instanceof Y.Map);
  const edgeLabels = draft.get(COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeLabels);
  assert.ok(edgeLabels instanceof Y.Map);

  const seenOrigins: unknown[] = [];
  doc.on("afterTransaction", (transaction) => seenOrigins.push(transaction.origin));
  const next = metadata();
  next.graph!.screens[0]!.title = "Dashboard";
  next.graph!.screens[0]!.identity!.aliases!.push("screen:dashboard");
  next.graph!.screens[0]!.observations![0]!.fingerprint = "screen:dashboard";
  next.positions.home = { x: 180, y: 120 };
  next.notes![0]!.text = "Review the signed-out state";
  next.edgeLabels["open-settings"] = "Configure";

  const projected = reconcileCollaborativeJourney(doc, next, { origin });

  assert.strictEqual(getCollaborativeJourneyRoot(doc), root);
  assert.strictEqual(
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens),
    screens,
  );
  assert.strictEqual(screens.get("home"), home);
  assert.strictEqual(home.get("identity"), identity);
  assert.strictEqual(home.get("observations"), observations);
  assert.strictEqual(observations.get(0), observation);
  assert.strictEqual(
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.connections),
    connections,
  );
  assert.strictEqual(connections.get("open-settings"), openSettings);
  assert.strictEqual(openSettings.get("destination"), destination);
  assert.strictEqual(
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.positions),
    positions,
  );
  assert.strictEqual(positions.get("home"), homePosition);
  assert.strictEqual(
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.notes),
    notes,
  );
  assert.strictEqual(notes.get("note-review"), note);
  assert.strictEqual(root.get(COLLABORATIVE_JOURNEY_ROOT_KEYS.draft), draft);
  assert.strictEqual(draft.get(COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeLabels), edgeLabels);
  assert.equal(seenOrigins.includes(origin), true);
  assert.deepEqual(materializeCollaborativeJourney(doc), projected);
  doc.destroy();
});

test("reconciliation adds and deletes granular entities, nested fields, positions, notes, and draft values", () => {
  const doc = createCollaborativeJourneyDoc(metadata());
  const screens = getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens);
  const retainedHome = screens.get("home");
  const next = metadata();
  next.graph!.screens = next.graph!.screens.filter((screen) => screen.id !== "archive");
  next.graph!.screens.push({
    id: "profile",
    title: "Profile",
    createdAt: 2,
    updatedAt: 2,
  });
  delete next.graph!.screens[0]!.identity;
  delete next.graph!.screens[0]!.observations;
  next.graph!.transitions = next.graph!.transitions.filter(
    (connection) => connection.id !== "open-archive",
  );
  next.graph!.transitions.push({
    id: "open-profile",
    fromScreenId: "settings",
    destination: { kind: "screen", screenId: "profile" },
    stepIds: [],
    state: "needs-recording",
    kind: "forward",
    createdAt: 2,
    updatedAt: 2,
  });
  delete next.positions.archive;
  next.positions.profile = { x: 640, y: 160 };
  next.notes = [];
  next.screenTitles = {};
  next.edgeLabels = { "open-profile": "Open profile" };
  next.edgeKinds = { "open-profile": "forward" };

  reconcileCollaborativeJourney(doc, next, { origin: "server-projection" });
  const value = materializeCollaborativeJourney(doc);

  assert.strictEqual(screens.get("home"), retainedHome);
  assert.equal(screens.has("archive"), false);
  assert.equal(screens.has("profile"), true);
  assert.equal(retainedHome!.has("identity"), false);
  assert.equal(retainedHome!.has("observations"), false);
  assert.deepEqual(
    value.graph?.screens.map((screen) => screen.id),
    ["home", "settings", "profile"],
  );
  assert.deepEqual(
    value.graph?.transitions.map((connection) => connection.id),
    ["open-settings", "open-profile"],
  );
  assert.deepEqual(value.positions.profile, { x: 640, y: 160 });
  assert.equal(value.positions.archive, undefined);
  assert.deepEqual(value.notes, []);
  assert.deepEqual(value.screenTitles, undefined);
  assert.deepEqual(value.edgeLabels, { "open-profile": "Open profile" });
  assert.deepEqual(value.edgeKinds, { "open-profile": "forward" });
  doc.destroy();
});

test("reconciliation is deterministic and a repeated projection is a Yjs no-op", () => {
  const doc = createCollaborativeJourneyDoc(metadata());
  const next = metadata();
  next.graph!.screens = [next.graph!.screens[2]!, next.graph!.screens[0]!, next.graph!.screens[1]!];
  next.graph!.transitions = [...next.graph!.transitions].reverse();

  const first = reconcileCollaborativeJourney(doc, next);
  const firstState = encodeCollaborativeJourneyUpdate(doc);
  const second = reconcileCollaborativeJourney(doc, next);
  const secondState = encodeCollaborativeJourneyUpdate(doc);

  assert.deepEqual(first, second);
  assert.deepEqual(firstState, secondState);
  assert.deepEqual(
    second.graph?.screens.map((screen) => screen.id),
    ["archive", "home", "settings"],
  );
  assert.deepEqual(
    second.graph?.transitions.map((connection) => connection.id),
    ["open-archive", "open-settings"],
  );
  assert.equal(JSON.stringify(materializeCollaborativeJourney(doc)), JSON.stringify(second));
  doc.destroy();
});

test("reconciliation strips forged authority fields by default and requires explicit validation to preserve them", () => {
  const forged = metadata();
  forged.graph!.screens[0]!.representativeStepId = "step-authoritative";
  Object.assign(forged.graph!.transitions[0]!, {
    stepIds: ["step-authoritative"],
    evidenceIds: ["evidence-authoritative"],
    takeId: "take-authoritative",
    review: { status: "verified", updatedAt: 5, verifiedAt: 5 },
    state: "recorded",
  });

  const untrusted = createCollaborativeJourneyDoc(metadata());
  const safeProjection = reconcileCollaborativeJourney(untrusted, forged);
  const safeScreen = safeProjection.graph!.screens[0]!;
  const safeConnection = safeProjection.graph!.transitions[0]!;
  assert.equal(safeScreen.representativeStepId, undefined);
  assert.deepEqual(safeConnection.stepIds, []);
  assert.equal(safeConnection.evidenceIds, undefined);
  assert.equal(safeConnection.takeId, undefined);
  assert.equal(safeConnection.review, undefined);
  assert.equal(safeConnection.state, "needs-recording");

  const rejected = createCollaborativeJourneyDoc(metadata());
  const rejectedBefore = encodeCollaborativeJourneyUpdate(rejected);
  assert.throws(
    () =>
      reconcileCollaborativeJourney(rejected, forged, {
        validateServerOwnedField: () => "reject",
      }),
    CollaborativeJourneyValidationError,
  );
  assert.deepEqual(encodeCollaborativeJourneyUpdate(rejected), rejectedBefore);

  const trusted = createCollaborativeJourneyDoc(metadata());
  const trustedProjection = reconcileCollaborativeJourney(trusted, forged, {
    origin: "trusted-server-projection",
    validateServerOwnedField: () => "preserve",
  });
  assert.deepEqual(
    materializeCollaborativeJourney(trusted, {
      validateServerOwnedField: () => "preserve",
    }),
    trustedProjection,
  );
  assert.deepEqual(trustedProjection.graph!.transitions[0]!.stepIds, ["step-authoritative"]);
  assert.equal(trustedProjection.graph!.transitions[0]!.state, "recorded");

  untrusted.destroy();
  rejected.destroy();
  trusted.destroy();
});

test("concurrent reconciliations of the same snapshot converge", () => {
  const left = createCollaborativeJourneyDoc(metadata());
  const right = new Y.Doc();
  applyCollaborativeJourneyUpdate(right, encodeCollaborativeJourneyUpdate(left), "initial-sync");
  const leftVector = encodeCollaborativeJourneyStateVector(left);
  const rightVector = encodeCollaborativeJourneyStateVector(right);

  left.transact(() => {
    getCollaborativeJourneyEntityMap(left, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get("home")!
      .set("title", "Stale left title");
  }, "left-edit");
  right.transact(() => {
    getCollaborativeJourneyEntityMap(right, COLLABORATIVE_JOURNEY_ROOT_KEYS.notes)
      .get("note-review")!
      .set("text", "Stale right note");
  }, "right-edit");

  const target = metadata();
  target.graph!.screens = target.graph!.screens.filter((screen) => screen.id !== "archive");
  target.graph!.screens.push({ id: "profile", title: "Profile", createdAt: 2, updatedAt: 2 });
  target.graph!.transitions = target.graph!.transitions.filter(
    (connection) => connection.id !== "open-archive",
  );
  delete target.positions.archive;
  target.positions.profile = { x: 640, y: 160 };
  reconcileCollaborativeJourney(left, target, { origin: "left-reconcile" });
  reconcileCollaborativeJourney(right, target, { origin: "right-reconcile" });

  const leftUpdate = encodeCollaborativeJourneyUpdate(left, rightVector);
  const rightUpdate = encodeCollaborativeJourneyUpdate(right, leftVector);
  applyCollaborativeJourneyUpdate(left, rightUpdate, "right-sync");
  applyCollaborativeJourneyUpdate(right, leftUpdate, "left-sync");

  assert.deepEqual(materializeCollaborativeJourney(left), materializeCollaborativeJourney(right));
  assert.deepEqual(encodeCollaborativeJourneyUpdate(left), encodeCollaborativeJourneyUpdate(right));
  left.destroy();
  right.destroy();
});
