import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  COLLABORATIVE_JOURNEY_ROOT_KEYS,
  applyCollaborativeJourneyUpdate,
  encodeCollaborativeJourneyStateVector,
  encodeCollaborativeJourneyUpdate,
  getCollaborativeJourneyEntityMap,
  materializeCollaborativeJourney,
} from "@relay/collaboration";
import { ApiError, RelayClient } from "@relay/client";
import { subscribe, type DeviceEvent } from "@relay/core";
import type { JourneyMetadata, ServerConnection } from "@relay/protocol";
import * as Y from "yjs";
import { CollaborationAwarenessService } from "./collaboration-awareness.js";
import {
  DurableCollaborativeJourneyStore,
  LocalCollaborativeJourneyStorageProvider,
} from "./collaborative-journey-store.js";
import { startServer } from "./index.js";

const journeyId = "recorded-checkout";

function connection(
  port: number,
  projectId: string,
  actorId: string,
  actorKind: "human" | "agent",
) {
  return {
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "organization-one",
    projectId,
    actorId,
    actorKind,
  } satisfies ServerConnection;
}

function recordedJourney(): JourneyMetadata {
  return {
    schemaVersion: 6,
    positions: { home: { x: 0, y: 0 }, done: { x: 320, y: 0 } },
    edgeLabels: {},
    edgeKinds: {},
    notes: [],
    takes: [
      {
        id: "take-1",
        recipeId: journeyId,
        startedAt: 1,
        finishedAt: 2,
        group: "recording",
        state: "kept",
        steps: [],
      },
    ],
    review: { state: "approved", updatedAt: 2, approvedAt: 2 },
    graph: {
      schemaVersion: 1,
      screens: [
        {
          id: "home",
          title: "Home",
          representativeStepId: "step-home",
          createdAt: 1,
          updatedAt: 1,
        },
        { id: "done", title: "Done", createdAt: 1, updatedAt: 1 },
      ],
      transitions: [
        {
          id: "submit",
          fromScreenId: "home",
          destination: { kind: "screen", screenId: "done" },
          stepIds: ["step-submit"],
          evidenceIds: ["evidence-submit"],
          takeId: "take-1",
          videoTakeId: "video-1",
          review: { status: "verified", updatedAt: 2, verifiedAt: 2 },
          state: "recorded",
          kind: "forward",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      flows: [{ id: "main", name: "Main", screenId: "home", createdAt: 1, updatedAt: 1 }],
    },
  };
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function renameScreen(doc: Y.Doc, screenId: string, title: string): Uint8Array {
  const vector = encodeCollaborativeJourneyStateVector(doc);
  doc.transact(() => {
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
      .get(screenId)!
      .set("title", title);
  }, "test-local");
  return encodeCollaborativeJourneyUpdate(doc, vector);
}

function moveScreen(doc: Y.Doc, screenId: string, x: number): Uint8Array {
  const vector = encodeCollaborativeJourneyStateVector(doc);
  doc.transact(() => {
    getCollaborativeJourneyEntityMap(doc, COLLABORATIVE_JOURNEY_ROOT_KEYS.positions)
      .get(screenId)!
      .set("x", x);
  }, "test-local");
  return encodeCollaborativeJourneyUpdate(doc, vector);
}

async function rawOperation(input: {
  connection: ServerConnection;
  operationId: string;
  path: string;
  method: string;
  body?: unknown;
}): Promise<Response> {
  return fetch(`${input.connection.url}${input.path}`, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      "X-Organization-Id": input.connection.organizationId,
      "X-Project-Id": input.connection.projectId,
      "X-Relay-Actor-Id": input.connection.actorId,
      "X-Relay-Actor-Kind": input.connection.actorKind,
      "X-Relay-Operation-Id": input.operationId,
      "X-Relay-Request-Id": crypto.randomUUID(),
      "X-Relay-Command-At": String(Date.now()),
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(input.body ?? {}),
  });
}

test("collaboration transport is disabled by default and has no fallback authority", async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const client = new RelayClient(
    connection(server.port, "disabled-project", "human:disabled", "human"),
  );
  try {
    await assert.rejects(
      () => client.bootstrapCollaboration(journeyId),
      (error: unknown) =>
        error instanceof ApiError && error.status === 404 && /disabled/.test(error.message),
    );
  } finally {
    await server.close();
  }
});

test("server-owned bootstrap, two-client sync, bounds, idempotency, scope, and awareness hold", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "relay-collaboration-routes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  let clock = 10_000;
  const store = new DurableCollaborativeJourneyStore({
    storage: new LocalCollaborativeJourneyStorageProvider({ rootDirectory: join(root, "yjs") }),
    limits: { maximumUpdatesPerActor: 1, rateWindowMs: 60_000 },
  });
  const awareness = new CollaborationAwarenessService({
    clock: () => clock,
    limits: { ttlMs: 1_000, throttleMs: 100 },
  });
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    collaboration: { enabled: true, store, awareness, clock: () => clock },
  });
  const humanConnection = connection(server.port, "project-one", "human:designer", "human");
  const agentConnection = connection(server.port, "project-one", "agent:indexer", "agent");
  const human = new RelayClient(humanConnection);
  const agent = new RelayClient(agentConnection);
  const isolated = new RelayClient(
    connection(server.port, "project-two", "agent:isolated", "agent"),
  );
  const events: DeviceEvent[] = [];
  const unsubscribe = subscribe((event) => events.push(event));
  const documents: Y.Doc[] = [];
  context.after(async () => {
    unsubscribe();
    for (const document of documents) document.destroy();
    await server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  });

  const initial = await human.journey(journeyId);
  const canonical = recordedJourney();
  await human.updateJourney(journeyId, {
    expectedRevision: initial.revision,
    value: canonical,
    idempotencyKey: "canonical-recorded-journey",
  });

  const bootstrap = await human.bootstrapCollaboration(journeyId);
  const humanDoc = new Y.Doc();
  documents.push(humanDoc);
  applyCollaborativeJourneyUpdate(humanDoc, fromBase64(bootstrap.updateBase64), "bootstrap");
  const safe = materializeCollaborativeJourney(humanDoc);
  const safeTransition = safe.graph?.transitions.find(({ id }) => id === "submit");
  assert.deepEqual(safeTransition?.stepIds, []);
  assert.equal(safeTransition?.evidenceIds, undefined);
  assert.equal(safeTransition?.takeId, undefined);
  assert.equal(safeTransition?.videoTakeId, undefined);
  assert.equal(safeTransition?.review, undefined);
  assert.equal(safeTransition?.state, "needs-recording");
  assert.equal(safe.graph?.screens[0]?.representativeStepId, undefined);
  assert.equal(safe.takes, undefined);
  assert.equal(safe.review, undefined);

  const unchanged = await human.journey(journeyId);
  assert.deepEqual(
    unchanged.value,
    canonical,
    "bootstrap must not rewrite canonical Journey authority",
  );

  const agentDoc = new Y.Doc();
  documents.push(agentDoc);
  const agentSync = await agent.syncCollaboration(
    journeyId,
    Buffer.from(encodeCollaborativeJourneyStateVector(agentDoc)).toString("base64"),
  );
  applyCollaborativeJourneyUpdate(agentDoc, fromBase64(agentSync.updateBase64), "sync");

  const humanUpdate = renameScreen(humanDoc, "home", "Dashboard");
  const firstAppend = await human.appendCollaborationUpdate(
    journeyId,
    Buffer.from(humanUpdate).toString("base64"),
    "human-tab:update-1",
  );
  assert.equal(firstAppend.applied, true);
  const duplicate = await human.appendCollaborationUpdate(
    journeyId,
    Buffer.from(humanUpdate).toString("base64"),
    "human-tab:update-1",
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.applied, false);

  const agentDelta = await agent.syncCollaboration(
    journeyId,
    Buffer.from(encodeCollaborativeJourneyStateVector(agentDoc)).toString("base64"),
  );
  applyCollaborativeJourneyUpdate(agentDoc, fromBase64(agentDelta.updateBase64), "sync");
  assert.equal(
    materializeCollaborativeJourney(agentDoc).graph?.screens.find(({ id }) => id === "home")?.title,
    "Dashboard",
  );

  const agentUpdate = moveScreen(agentDoc, "done", 640);
  await agent.appendCollaborationUpdate(
    journeyId,
    Buffer.from(agentUpdate).toString("base64"),
    "agent-tab:update-1",
  );
  const humanDelta = await human.syncCollaboration(
    journeyId,
    Buffer.from(encodeCollaborativeJourneyStateVector(humanDoc)).toString("base64"),
  );
  applyCollaborativeJourneyUpdate(humanDoc, fromBase64(humanDelta.updateBase64), "sync");
  assert.deepEqual(
    materializeCollaborativeJourney(humanDoc),
    materializeCollaborativeJourney(agentDoc),
  );

  const conflicting = moveScreen(humanDoc, "home", 111);
  await assert.rejects(
    () =>
      human.appendCollaborationUpdate(
        journeyId,
        Buffer.from(conflicting).toString("base64"),
        "human-tab:update-1",
      ),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
  await assert.rejects(
    () =>
      human.appendCollaborationUpdate(
        journeyId,
        Buffer.from(conflicting).toString("base64"),
        "human-tab:update-2",
      ),
    (error: unknown) => error instanceof ApiError && error.status === 429,
  );

  const forgedDoc = new Y.Doc();
  documents.push(forgedDoc);
  applyCollaborativeJourneyUpdate(
    forgedDoc,
    encodeCollaborativeJourneyUpdate(agentDoc),
    "forged-seed",
  );
  const forgedVector = encodeCollaborativeJourneyStateVector(forgedDoc);
  forgedDoc.transact(() => {
    const steps = new Y.Array<string>();
    steps.push(["forged-step"]);
    getCollaborativeJourneyEntityMap(forgedDoc, COLLABORATIVE_JOURNEY_ROOT_KEYS.connections)
      .get("submit")!
      .set("stepIds", steps);
  }, "forged");
  await assert.rejects(
    () =>
      new RelayClient(
        connection(server.port, "project-one", "agent:forger", "agent"),
      ).appendCollaborationUpdate(
        journeyId,
        Buffer.from(encodeCollaborativeJourneyUpdate(forgedDoc, forgedVector)).toString("base64"),
        "forger:update-1",
      ),
    (error: unknown) => error instanceof ApiError && error.status === 422,
  );

  const isolatedBootstrap = await isolated.bootstrapCollaboration(journeyId);
  const isolatedDoc = new Y.Doc();
  documents.push(isolatedDoc);
  applyCollaborativeJourneyUpdate(
    isolatedDoc,
    fromBase64(isolatedBootstrap.updateBase64),
    "isolated-bootstrap",
  );
  assert.deepEqual(materializeCollaborativeJourney(isolatedDoc).graph?.screens, []);

  await assert.rejects(
    () => human.syncCollaboration(journeyId, "not base64"),
    /canonical padded base64/,
  );
  await assert.rejects(
    () => human.syncCollaboration(journeyId, "/w=="),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
  const oversized = Buffer.alloc(256 * 1024 + 1).toString("base64");
  const oversizedResponse = await rawOperation({
    connection: humanConnection,
    operationId: "collaboration.document.sync",
    path: `/journeys/${journeyId}/collaboration/sync`,
    method: "POST",
    body: { stateVectorBase64: oversized },
  });
  assert.equal(oversizedResponse.status, 400);

  const humanPresence = await human.publishCollaborationAwareness({
    journeyId,
    displayName: "  Product   Designer  ",
    avatarToken: "avatar.human",
    cursor: { x: 10, y: 20 },
    selection: { screenId: "home" },
    viewport: { x: 0, y: 0, zoom: 1, width: 1200, height: 800 },
    activity: "editing",
  });
  assert.equal(humanPresence.awareness.actorId, "human:designer");
  assert.equal(humanPresence.awareness.actorKind, "human");
  assert.equal(humanPresence.awareness.displayName, "Product Designer");
  await agent.publishCollaborationAwareness({
    journeyId,
    displayName: "Map agent",
    activity: "running",
  });
  const presence = await human.collaborationAwareness(journeyId);
  assert.deepEqual(
    presence.awareness.map(({ actorId, actorKind }) => [actorId, actorKind]),
    [
      ["agent:indexer", "agent"],
      ["human:designer", "human"],
    ],
  );
  await assert.rejects(
    () => human.publishCollaborationAwareness({ journeyId, activity: "idle" }),
    (error: unknown) => error instanceof ApiError && error.status === 429,
  );
  await assert.rejects(
    () =>
      human.publishCollaborationAwareness({
        journeyId,
        displayName: "x".repeat(81),
        activity: "idle",
      }),
    /privacy-safe label/,
  );
  const spoof = await rawOperation({
    connection: humanConnection,
    operationId: "collaboration.awareness.publish",
    path: `/journeys/${journeyId}/collaboration/awareness`,
    method: "PUT",
    body: { actorId: "agent:spoofed", actorKind: "agent", activity: "idle" },
  });
  assert.equal(spoof.status, 400);

  clock += 101;
  assert.equal((await human.removeCollaborationAwareness(journeyId)).removed, true);
  assert.deepEqual(
    (await agent.collaborationAwareness(journeyId)).awareness.map(({ actorId }) => actorId),
    ["agent:indexer"],
  );
  clock += 1_001;
  assert.deepEqual((await human.collaborationAwareness(journeyId)).awareness, []);

  const collaborationEvent = events.find(
    (event) => event.operationId === "collaboration.update.append",
  );
  assert.equal(collaborationEvent?.actorId, "human:designer");
  assert.equal(collaborationEvent?.projectId, "project-one");
});
