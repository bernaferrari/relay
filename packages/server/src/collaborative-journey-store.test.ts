import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  COLLABORATIVE_JOURNEY_ROOT_KEYS,
  applyCollaborativeJourneyUpdate,
  createCollaborativeJourneyDoc,
  encodeCollaborativeJourneyStateVector,
  encodeCollaborativeJourneyUpdate,
  getCollaborativeJourneyEntityMap,
  materializeCollaborativeJourney,
} from "@relay/collaboration";
import type { JourneyMetadata } from "@relay/protocol";
import * as Y from "yjs";
import {
  CollaborativeJourneyStoreError,
  DurableCollaborativeJourneyStore,
  LocalCollaborativeJourneyStorageProvider,
  type CollaborativeJourneyDocumentState,
  type CollaborativeJourneyScope,
  type DurableCollaborativeJourneyStoreOptions,
} from "./collaborative-journey-store.js";

const scope: CollaborativeJourneyScope = {
  organizationId: "organization-one",
  projectId: "project-one",
  journeyId: "journey-one",
};

function metadata(): JourneyMetadata {
  return {
    schemaVersion: 6,
    positions: {
      home: { x: 40, y: 60 },
      settings: { x: 360, y: 60 },
    },
    edgeLabels: {},
    edgeKinds: {},
    graph: {
      schemaVersion: 1,
      screens: [
        { id: "home", title: "Home", createdAt: 1, updatedAt: 1 },
        { id: "settings", title: "Settings", createdAt: 1, updatedAt: 1 },
      ],
      transitions: [
        {
          id: "open-settings",
          fromScreenId: "home",
          destination: { kind: "screen", screenId: "settings" },
          stepIds: [],
          state: "needs-recording",
          kind: "forward",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      flows: [{ id: "main", name: "Main", screenId: "home", createdAt: 1, updatedAt: 1 }],
    },
  };
}

function updateScreenTitle(doc: Y.Doc, title: string): Uint8Array {
  const vector = encodeCollaborativeJourneyStateVector(doc);
  doc.transact(() => {
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get("home")!
      .set("title", title);
  }, "test-local");
  return encodeCollaborativeJourneyUpdate(doc, vector);
}

function updateScreenPosition(doc: Y.Doc, x: number): Uint8Array {
  const vector = encodeCollaborativeJourneyStateVector(doc);
  doc.transact(() => {
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.positions)
      .get("home")!
      .set("x", x);
  }, "test-local");
  return encodeCollaborativeJourneyUpdate(doc, vector);
}

function readMetadata(state: CollaborativeJourneyDocumentState): JourneyMetadata {
  const doc = new Y.Doc();
  applyCollaborativeJourneyUpdate(doc, state.documentUpdate, "test-read");
  try {
    return materializeCollaborativeJourney(doc);
  } finally {
    doc.destroy();
  }
}

function homeTitle(state: CollaborativeJourneyDocumentState): string | undefined {
  return readMetadata(state).graph?.screens.find((screen) => screen.id === "home")?.title;
}

function homeX(state: CollaborativeJourneyDocumentState): number | undefined {
  return readMetadata(state).positions.home?.x;
}

async function fixture(
  options: Omit<DurableCollaborativeJourneyStoreOptions, "storage"> = {},
): Promise<{
  root: string;
  provider: LocalCollaborativeJourneyStorageProvider;
  store: DurableCollaborativeJourneyStore;
  doc: Y.Doc;
  bootstrap: Uint8Array;
}> {
  const root = await mkdtemp(join(tmpdir(), "relay-collaboration-store-"));
  const provider = new LocalCollaborativeJourneyStorageProvider({ rootDirectory: root });
  const store = new DurableCollaborativeJourneyStore({ storage: provider, ...options });
  const doc = createCollaborativeJourneyDoc(metadata());
  const bootstrap = encodeCollaborativeJourneyUpdate(doc);
  await store.open(scope, bootstrap);
  return { root, provider, store, doc, bootstrap };
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: CollaborativeJourneyStoreError["code"],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CollaborativeJourneyStoreError);
    assert.equal(error.code, code);
    return true;
  });
}

void test("restores every acknowledged update after a new service instance", async () => {
  const value = await fixture();
  try {
    const titleUpdate = updateScreenTitle(value.doc, "Dashboard");
    const positionUpdate = updateScreenPosition(value.doc, 240);
    await value.store.applyUpdate({ scope, actorId: "human-one", update: titleUpdate });
    await value.store.applyUpdate({ scope, actorId: "human-one", update: positionUpdate });

    const restarted = new DurableCollaborativeJourneyStore({
      storage: new LocalCollaborativeJourneyStorageProvider({ rootDirectory: value.root }),
    });
    const restored = await restarted.open(scope);
    assert.equal(homeTitle(restored), "Dashboard");
    assert.equal(homeX(restored), 240);
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});

void test("compacts safely and keeps duplicate updates idempotent across restart", async () => {
  const value = await fixture({ limits: { compactAfterUpdates: 2 } });
  try {
    const titleUpdate = updateScreenTitle(value.doc, "Dashboard");
    const positionUpdate = updateScreenPosition(value.doc, 180);
    await value.store.applyUpdate({ scope, actorId: "agent-one", update: titleUpdate });
    const compacted = await value.store.applyUpdate({
      scope,
      actorId: "agent-one",
      update: positionUpdate,
    });
    assert.equal(compacted.uncompactedUpdates, 0);

    const restarted = new DurableCollaborativeJourneyStore({
      storage: new LocalCollaborativeJourneyStorageProvider({ rootDirectory: value.root }),
    });
    const duplicate = await restarted.applyUpdate({
      scope,
      actorId: "agent-one",
      update: titleUpdate,
    });
    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(homeTitle(duplicate), "Dashboard");
    assert.equal(homeX(duplicate), 180);
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});

void test("retains causally out-of-order updates until their dependency arrives", async () => {
  const value = await fixture();
  try {
    const first = updateScreenTitle(value.doc, "Dashboard");
    const second = updateScreenPosition(value.doc, 420);
    const isolatedScope = { ...scope, journeyId: "out-of-order" };
    await value.store.open(isolatedScope, value.bootstrap);

    const pending = await value.store.applyUpdate({
      scope: isolatedScope,
      actorId: "agent-one",
      update: second,
    });
    assert.equal(pending.applied, true);
    assert.equal(pending.uncompactedUpdates, 1);
    const resolved = await value.store.applyUpdate({
      scope: isolatedScope,
      actorId: "agent-one",
      update: first,
    });
    assert.equal(homeTitle(resolved), "Dashboard");
    assert.equal(homeX(resolved), 420);
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});

void test("repairs only a corrupt log tail and preserves prior acknowledged edits", async () => {
  const value = await fixture();
  try {
    await value.store.applyUpdate({
      scope,
      actorId: "human-one",
      update: updateScreenTitle(value.doc, "Dashboard"),
    });
    await value.store.applyUpdate({
      scope,
      actorId: "human-one",
      update: updateScreenPosition(value.doc, 300),
    });
    const log = join(
      value.root,
      "organizations",
      scope.organizationId,
      "projects",
      scope.projectId,
      "journeys",
      scope.journeyId,
      "collaboration",
      "updates.log",
    );
    const before = (await readFile(log)).byteLength;
    const corruptTail = Buffer.from("RYU1\u0000\u0000", "binary");
    await appendFile(log, corruptTail);

    const restarted = new DurableCollaborativeJourneyStore({
      storage: new LocalCollaborativeJourneyStorageProvider({ rootDirectory: value.root }),
    });
    const restored = await restarted.open(scope);
    assert.equal(restored.repairedTailBytes, corruptTail.byteLength);
    assert.equal(homeTitle(restored), "Dashboard");
    assert.equal(homeX(restored), 300);
    assert.equal((await readFile(log)).byteLength, before);
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});

void test("isolates organization/project/Journey scopes and rejects path traversal", async () => {
  const value = await fixture();
  try {
    const otherScope = { ...scope, projectId: "project-two" };
    await value.store.open(otherScope, value.bootstrap);
    const changed = await value.store.applyUpdate({
      scope,
      actorId: "agent:mcp:test",
      update: updateScreenTitle(value.doc, "Private dashboard"),
    });
    const unchanged = await value.store.open(otherScope);
    assert.equal(homeTitle(changed), "Private dashboard");
    assert.equal(homeTitle(unchanged), "Home");

    await rejectsWithCode(
      value.store.open({ ...scope, journeyId: "../../other" }, value.bootstrap),
      "invalid-scope",
    );
    await rejectsWithCode(
      value.store.applyUpdate({
        scope,
        actorId: "../agent",
        update: new Uint8Array([1]),
      }),
      "invalid-actor",
    );
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});

void test("enforces update, document, uncompacted-log, and per-actor rate bounds", async () => {
  const value = await fixture({
    limits: {
      maximumUpdateBytes: 1_024,
      maximumDocumentBytes: 4_096,
      maximumUncompactedBytes: 1_200,
      maximumUpdatesPerActor: 1,
      rateWindowMs: 1_000,
    },
    clock: () => 100,
  });
  try {
    await rejectsWithCode(
      value.store.applyUpdate({
        scope,
        actorId: "human-one",
        update: new Uint8Array(1_025),
      }),
      "update-too-large",
    );
    await value.store.applyUpdate({
      scope,
      actorId: "human-one",
      update: updateScreenTitle(value.doc, "Dashboard"),
    });
    await rejectsWithCode(
      value.store.applyUpdate({
        scope,
        actorId: "human-one",
        update: updateScreenPosition(value.doc, 90),
      }),
      "rate-limited",
    );

    const boundedScope = { ...scope, journeyId: "document-bound" };
    const bounded = new DurableCollaborativeJourneyStore({
      storage: value.provider,
      limits: {
        maximumUpdateBytes: 2_048,
        maximumDocumentBytes: value.bootstrap.byteLength + 48,
        maximumUncompactedBytes: 4_096,
      },
    });
    await bounded.open(boundedScope, value.bootstrap);
    const largeDoc = createCollaborativeJourneyDoc(metadata());
    const largeUpdate = updateScreenTitle(largeDoc, "x".repeat(700));
    await rejectsWithCode(
      bounded.applyUpdate({ scope: boundedScope, actorId: "agent-two", update: largeUpdate }),
      "document-too-large",
    );
    largeDoc.destroy();

    const logScope = { ...scope, journeyId: "log-bound" };
    const logBound = new DurableCollaborativeJourneyStore({
      storage: value.provider,
      limits: {
        maximumUpdateBytes: 1_024,
        maximumDocumentBytes: 4_096,
        maximumUncompactedBytes: 60,
      },
    });
    await logBound.open(logScope, value.bootstrap);
    const logDoc = createCollaborativeJourneyDoc(metadata());
    const logUpdate = updateScreenTitle(logDoc, "A title large enough for the log bound");
    await rejectsWithCode(
      logBound.applyUpdate({ scope: logScope, actorId: "agent-three", update: logUpdate }),
      "document-too-large",
    );
    logDoc.destroy();
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});

void test("recovers when compaction commits a snapshot but crashes before replacing the log", async () => {
  const value = await fixture();
  try {
    await value.store.applyUpdate({
      scope,
      actorId: "human-one",
      update: updateScreenTitle(value.doc, "Crash-safe dashboard"),
    });
    const crashing = new DurableCollaborativeJourneyStore({
      storage: new LocalCollaborativeJourneyStorageProvider({
        rootDirectory: value.root,
        fault(point) {
          if (point === "after-snapshot-rename") throw new Error("simulated process death");
        },
      }),
    });
    await crashing.open(scope);
    await assert.rejects(() => crashing.compact(scope), /simulated process death/);

    const restarted = new DurableCollaborativeJourneyStore({
      storage: new LocalCollaborativeJourneyStorageProvider({ rootDirectory: value.root }),
    });
    const restored = await restarted.open(scope);
    assert.equal(homeTitle(restored), "Crash-safe dashboard");
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});

void test("rejects forged executable and review authority before acknowledging bytes", async () => {
  const value = await fixture();
  try {
    const vector = encodeCollaborativeJourneyStateVector(value.doc);
    value.doc.transact(() => {
      const connection = getCollaborativeJourneyEntityMap(
        value.doc,
        COLLABORATIVE_JOURNEY_ROOT_KEYS.connections,
      ).get("open-settings")!;
      connection.set("state", "recorded");
      const stepIds = new Y.Array<string>();
      stepIds.push(["forged-step"]);
      connection.set("stepIds", stepIds);
    }, "forged-edit");
    const forged = encodeCollaborativeJourneyUpdate(value.doc, vector);
    await rejectsWithCode(
      value.store.applyUpdate({ scope, actorId: "agent-one", update: forged }),
      "forged-authority",
    );

    const restarted = new DurableCollaborativeJourneyStore({
      storage: new LocalCollaborativeJourneyStorageProvider({ rootDirectory: value.root }),
    });
    const restored = readMetadata(await restarted.open(scope));
    const connection = restored.graph?.transitions.find(
      (candidate) => candidate.id === "open-settings",
    );
    assert.equal(connection?.state, "needs-recording");
    assert.deepEqual(connection?.stepIds, []);
  } finally {
    value.doc.destroy();
    await rm(value.root, { recursive: true, force: true });
  }
});
