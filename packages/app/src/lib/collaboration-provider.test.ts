import assert from "node:assert/strict";
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
  CollaborationProvider,
  type CollaborationScope,
  type CollaborationSubscription,
  type CollaborationTransport,
  type CollaborationUpdate,
} from "./collaboration-provider.js";

const scope: CollaborationScope = { projectId: "project-1", journeyId: "journey-1" };

function metadata(): JourneyMetadata {
  return {
    schemaVersion: 6,
    positions: { home: { x: 0, y: 0 }, settings: { x: 320, y: 0 } },
    edgeLabels: {},
    edgeKinds: {},
    notes: [],
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

function title(doc: Y.Doc, screenId: string): string | undefined {
  return materializeCollaborativeJourney(doc).graph?.screens.find(
    (screen) => screen.id === screenId,
  )?.title;
}

function rename(doc: Y.Doc, screenId: string, value: string, origin: unknown): void {
  doc.transact(() => {
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get(screenId)!
      .set("title", value);
  }, origin);
}

async function waitFor(
  assertion: () => boolean,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!assertion()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type Subscriber = {
  listener: (update: CollaborationUpdate) => void;
  onDisconnect: (error?: unknown) => void;
};

class InMemoryCollaborationHub {
  readonly doc = new Y.Doc();
  readonly acknowledged = new Set<string>();
  readonly subscribers = new Set<Subscriber>();
  handshakeCalls = 0;
  pushCalls = 0;
  subscribeCalls = 0;
  online = true;

  readonly transport: CollaborationTransport = {
    handshake: async ({ stateVector, signal }) => {
      this.handshakeCalls += 1;
      this.#assertAvailable(signal);
      return {
        stateVector: encodeCollaborativeJourneyStateVector(this.doc),
        updates: [
          {
            id: `hub:handshake:${this.handshakeCalls}`,
            bytes: encodeCollaborativeJourneyUpdate(this.doc, stateVector),
          },
        ],
      };
    },
    push: async ({ updates, signal }) => {
      this.pushCalls += 1;
      this.#assertAvailable(signal);
      for (const update of updates) {
        if (!this.acknowledged.has(update.id)) {
          this.acknowledged.add(update.id);
          applyCollaborativeJourneyUpdate(this.doc, update.bytes, "hub-remote");
        }
        this.#broadcast(update);
      }
      return { acknowledgedUpdateIds: updates.map((update) => update.id) };
    },
    subscribe: (_scope, listener, onDisconnect): CollaborationSubscription => {
      this.subscribeCalls += 1;
      const subscriber = { listener, onDisconnect };
      this.subscribers.add(subscriber);
      return { close: () => this.subscribers.delete(subscriber) };
    },
  };

  disconnect(): void {
    this.online = false;
    const subscribers = [...this.subscribers];
    this.subscribers.clear();
    for (const subscriber of subscribers) subscriber.onDisconnect(new Error("hub offline"));
  }

  reconnect(): void {
    this.online = true;
  }

  publish(updates: readonly CollaborationUpdate[]): void {
    for (const update of updates) {
      applyCollaborativeJourneyUpdate(this.doc, update.bytes, "hub-publish");
      this.#broadcast(update);
    }
  }

  emitUnchecked(update: CollaborationUpdate): void {
    this.#broadcast(update);
  }

  #broadcast(update: CollaborationUpdate): void {
    if (!this.online) return;
    for (const subscriber of this.subscribers) {
      subscriber.listener({ id: update.id, bytes: new Uint8Array(update.bytes) });
    }
  }

  #assertAvailable(signal: AbortSignal): void {
    if (signal.aborted) throw new Error("aborted");
    if (!this.online) throw new Error("hub offline");
  }
}

function provider(
  doc: Y.Doc,
  hub: InMemoryCollaborationHub,
  clientId: string,
  options: Partial<ConstructorParameters<typeof CollaborationProvider>[0]> = {},
): CollaborationProvider {
  return new CollaborationProvider({
    enabled: true,
    doc,
    transport: hub.transport,
    scope,
    clientId,
    retryBaseMs: 5,
    retryMaximumMs: 20,
    ...options,
  });
}

test("offline edits queue and converge after a bounded reconnect handshake", async () => {
  const hub = new InMemoryCollaborationHub();
  const doc = createCollaborativeJourneyDoc(metadata());
  const sync = provider(doc, hub, "tab-a");
  await sync.start();
  await waitFor(() => sync.snapshot.pendingUpdates === 0, "initial upload");

  hub.disconnect();
  rename(doc, "home", "Offline dashboard", sync.localOrigin);
  assert.equal(sync.snapshot.status, "offline");
  assert.equal(sync.snapshot.pendingUpdates, 1);

  hub.reconnect();
  await waitFor(
    () => sync.snapshot.status === "online" && sync.snapshot.pendingUpdates === 0,
    "offline edit convergence",
  );
  assert.equal(title(hub.doc, "home"), "Offline dashboard");
  assert.ok(hub.handshakeCalls >= 2);
  sync.destroy();
  doc.destroy();
  hub.doc.destroy();
});

test("duplicate and out-of-order remote updates are idempotent and converge", async () => {
  const hub = new InMemoryCollaborationHub();
  const local = createCollaborativeJourneyDoc(metadata());
  const sync = provider(local, hub, "tab-local");
  await sync.start();
  await waitFor(() => sync.snapshot.pendingUpdates === 0, "seed upload");

  const baseVector = encodeCollaborativeJourneyStateVector(hub.doc);
  const first = new Y.Doc();
  const second = new Y.Doc();
  applyCollaborativeJourneyUpdate(first, encodeCollaborativeJourneyUpdate(hub.doc), "seed");
  applyCollaborativeJourneyUpdate(second, encodeCollaborativeJourneyUpdate(hub.doc), "seed");
  rename(first, "home", "Dashboard", "remote-a");
  rename(second, "settings", "Preferences", "remote-b");
  const updateA = {
    id: "remote:a",
    bytes: encodeCollaborativeJourneyUpdate(first, baseVector),
  };
  const updateB = {
    id: "remote:b",
    bytes: encodeCollaborativeJourneyUpdate(second, baseVector),
  };

  hub.publish([updateB, updateA, updateB]);
  await waitFor(
    () => title(local, "home") === "Dashboard" && title(local, "settings") === "Preferences",
    "out-of-order updates",
  );
  assert.deepEqual(
    encodeCollaborativeJourneyUpdate(local),
    encodeCollaborativeJourneyUpdate(hub.doc),
  );
  sync.destroy();
  local.destroy();
  first.destroy();
  second.destroy();
  hub.doc.destroy();
});

test("two clients converge materially and byte-equivalently, including a tab reload", async () => {
  const hub = new InMemoryCollaborationHub();
  const left = createCollaborativeJourneyDoc(metadata());
  const right = new Y.Doc();
  const leftSync = provider(left, hub, "tab-left");
  const rightSync = provider(right, hub, "tab-right");
  await leftSync.start();
  await rightSync.start();

  rename(left, "home", "Dashboard", leftSync.localOrigin);
  rename(right, "settings", "Preferences", rightSync.localOrigin);
  await waitFor(
    () =>
      leftSync.snapshot.pendingUpdates === 0 &&
      rightSync.snapshot.pendingUpdates === 0 &&
      title(left, "settings") === "Preferences" &&
      title(right, "home") === "Dashboard",
    "two-client convergence",
  );
  assert.deepEqual(materializeCollaborativeJourney(left), materializeCollaborativeJourney(right));
  assert.deepEqual(encodeCollaborativeJourneyUpdate(left), encodeCollaborativeJourneyUpdate(right));

  rightSync.destroy();
  right.destroy();
  rename(left, "home", "Reloaded dashboard", leftSync.localOrigin);
  await waitFor(() => leftSync.snapshot.pendingUpdates === 0, "post-close edit");

  const reloaded = new Y.Doc();
  const reloadSync = provider(reloaded, hub, "tab-reloaded");
  await reloadSync.start();
  await waitFor(() => title(reloaded, "home") === "Reloaded dashboard", "reload handshake");
  assert.deepEqual(
    encodeCollaborativeJourneyUpdate(reloaded),
    encodeCollaborativeJourneyUpdate(left),
  );
  reloadSync.destroy();
  leftSync.destroy();
  reloaded.destroy();
  left.destroy();
  hub.doc.destroy();
});

test("remote edits are excluded from the local UndoManager", async () => {
  const hub = new InMemoryCollaborationHub();
  const local = createCollaborativeJourneyDoc(metadata());
  const remote = new Y.Doc();
  const localSync = provider(local, hub, "tab-local");
  const remoteSync = provider(remote, hub, "tab-remote");
  await localSync.start();
  await remoteSync.start();
  const undo = localSync.createUndoManager(0);

  rename(local, "home", "Local dashboard", localSync.localOrigin);
  rename(remote, "settings", "Remote preferences", remoteSync.localOrigin);
  await waitFor(
    () => title(local, "settings") === "Remote preferences",
    "remote edit reaches local client",
  );
  undo.undo();
  await waitFor(() => localSync.snapshot.pendingUpdates === 0, "undo synchronization");
  assert.equal(title(local, "home"), "Home");
  assert.equal(title(local, "settings"), "Remote preferences");

  undo.destroy();
  localSync.destroy();
  remoteSync.destroy();
  local.destroy();
  remote.destroy();
  hub.doc.destroy();
});

test("disabled collaboration performs no network work and creates no fallback write path", async () => {
  const hub = new InMemoryCollaborationHub();
  const doc = createCollaborativeJourneyDoc(metadata());
  const sync = new CollaborationProvider({
    enabled: false,
    doc,
    transport: hub.transport,
    scope,
    clientId: "disabled-tab",
  });
  await sync.start();
  rename(doc, "home", "Private draft", sync.localOrigin);

  assert.equal(sync.snapshot.status, "disabled");
  assert.equal(sync.snapshot.pendingUpdates, 0);
  assert.equal(hub.handshakeCalls, 0);
  assert.equal(hub.pushCalls, 0);
  assert.equal(hub.subscribeCalls, 0);
  assert.equal(encodeCollaborativeJourneyUpdate(hub.doc).byteLength, 2);
  sync.destroy();
  doc.destroy();
  hub.doc.destroy();
});

test("forged executable metadata is rejected locally and never reaches the hub", async (context) => {
  const hub = new InMemoryCollaborationHub();
  const doc = createCollaborativeJourneyDoc(metadata());
  const sync = provider(doc, hub, "forged-metadata-tab");
  context.after(() => {
    sync.destroy();
    doc.destroy();
    hub.doc.destroy();
  });
  await sync.start();
  await waitFor(() => sync.snapshot.pendingUpdates === 0, "initial safe document upload");
  const pushesBeforeForgery = hub.pushCalls;

  doc.transact(() => {
    const connection = getCollaborativeJourneyEntityMap(
      doc,
      COLLABORATIVE_JOURNEY_ROOT_KEYS.connections,
    ).get("open-settings")!;
    const forgedSteps = new Y.Array<string>();
    forgedSteps.push(["forged-step"]);
    connection.set("stepIds", forgedSteps);
    connection.set("state", "recorded");
  }, sync.localOrigin);

  assert.equal(sync.snapshot.status, "offline");
  assert.match(sync.snapshot.lastError?.message ?? "", /collaborative document rejected/i);
  assert.equal(sync.snapshot.pendingUpdates, 0);
  assert.equal(hub.pushCalls, pushesBeforeForgery);
  const authoritative = materializeCollaborativeJourney(hub.doc);
  const connection = authoritative.graph?.transitions.find(
    (transition) => transition.id === "open-settings",
  );
  assert.deepEqual(connection?.stepIds, []);
  assert.equal(connection?.state, "needs-recording");
});

test("queue, update, and document bounds reject unbounded memory growth", async (context) => {
  const queueHub = new InMemoryCollaborationHub();
  const queueDoc = createCollaborativeJourneyDoc(metadata());
  const queueSync = provider(queueDoc, queueHub, "queue-tab", {
    limits: { maxQueuedUpdates: 1 },
  });
  const byteQueueHub = new InMemoryCollaborationHub();
  const byteQueueDoc = createCollaborativeJourneyDoc(metadata());
  const byteQueueSync = provider(byteQueueDoc, byteQueueHub, "byte-queue-tab", {
    limits: { maxQueuedBytes: 8 },
  });
  const remoteHub = new InMemoryCollaborationHub();
  const remoteDoc = createCollaborativeJourneyDoc(metadata());
  const remoteSync = provider(remoteDoc, remoteHub, "remote-bound-tab", {
    limits: { maxUpdateBytes: 4_096 },
  });
  const documentHub = new InMemoryCollaborationHub();
  const documentDoc = createCollaborativeJourneyDoc(metadata());
  const documentSync = provider(documentDoc, documentHub, "document-bound-tab", {
    limits: { maxDocumentBytes: 32 },
  });
  context.after(() => {
    queueSync.destroy();
    byteQueueSync.destroy();
    remoteSync.destroy();
    documentSync.destroy();
    queueDoc.destroy();
    byteQueueDoc.destroy();
    remoteDoc.destroy();
    documentDoc.destroy();
    queueHub.doc.destroy();
    byteQueueHub.doc.destroy();
    remoteHub.doc.destroy();
    documentHub.doc.destroy();
  });

  await queueSync.start();
  await waitFor(() => queueSync.snapshot.pendingUpdates === 0, "queue seed");
  queueHub.disconnect();
  rename(queueDoc, "home", "First offline edit", queueSync.localOrigin);
  rename(queueDoc, "settings", "Second offline edit", queueSync.localOrigin);
  assert.equal(queueSync.snapshot.pendingUpdates, 1);
  queueHub.reconnect();
  await waitFor(
    () => queueSync.snapshot.status === "online" && queueSync.snapshot.pendingUpdates === 0,
    "compacted queue convergence",
  );
  assert.equal(title(queueHub.doc, "home"), "First offline edit");
  assert.equal(title(queueHub.doc, "settings"), "Second offline edit");

  await byteQueueSync.start();
  assert.equal(byteQueueSync.snapshot.status, "offline");
  assert.match(byteQueueSync.snapshot.lastError?.message ?? "", /queue byte bound/i);

  await remoteSync.start();
  remoteHub.emitUnchecked({ id: "oversized", bytes: new Uint8Array(4_097) });
  assert.match(remoteSync.snapshot.lastError?.message ?? "", /remote update exceeds 4096 bytes/i);

  await documentSync.start();
  assert.equal(documentSync.snapshot.status, "offline");
  assert.match(documentSync.snapshot.lastError?.message ?? "", /document byte bound exceeded/i);
});
