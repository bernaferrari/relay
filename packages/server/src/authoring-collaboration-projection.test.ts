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
import { subscribe, type AuthoringRuntime, type DeviceEvent } from "@relay/core";
import type {
  AuthoringInteraction,
  AuthoringSession,
  RecipeStep,
  ServerConnection,
} from "@relay/protocol";
import * as Y from "yjs";
import {
  DurableCollaborativeJourneyStore,
  LocalCollaborativeJourneyStorageProvider,
  type CollaborativeJourneyStorageProvider,
} from "./collaborative-journey-store.js";
import { createCollaborationRouteService } from "./collaboration-routes.js";
import { startServer } from "./index.js";

class ProjectionRuntime implements AuthoringRuntime {
  screen = "source";
  observations = 0;

  async observe() {
    this.observations += 1;
    const capturedAt = 10_000 + this.observations;
    return {
      capturedAt,
      targetId: "device-projection",
      fingerprint: `fingerprint-${this.screen}`,
      bounds: { width: 400, height: 800 },
      nodes: [{ role: "button", label: this.screen }],
      screenshot: { data: Buffer.from(`png:${this.screen}`), mime: "image/png" },
    };
  }

  async execute(_session: AuthoringSession, interaction: AuthoringInteraction) {
    if (interaction.kind === "key") this.screen = "destination";
  }

  async replay(_session: AuthoringSession, _steps: RecipeStep[]) {}

  async startVideo() {}

  async stopVideo() {
    return { data: Buffer.from("video"), mime: "video/mp4" };
  }
}

function connection(port: number, actorId: string, actorKind: "human" | "agent") {
  return {
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "project-projection",
    actorId,
    actorKind,
  } satisfies ServerConnection;
}

function bytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function withEnvironment<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-authoring-projection-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    state: process.env.RELAY_STATE_DIR,
    recipes: process.env.RELAY_RECIPES_DIR,
    legacyRecipes: process.env.GROK_DEVICE_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.GROK_DEVICE_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  try {
    return await run(root);
  } finally {
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.legacyRecipes === undefined) delete process.env.GROK_DEVICE_RECIPES_DIR;
    else process.env.GROK_DEVICE_RECIPES_DIR = previous.legacyRecipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
}

test("a reviewed authoring commit is projected as a safe collaborative graph", async () => {
  await withEnvironment(async (root) => {
    const store = new DurableCollaborativeJourneyStore({
      storage: new LocalCollaborativeJourneyStorageProvider({
        rootDirectory: join(root, "collaboration"),
      }),
    });
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      authoringRuntime: new ProjectionRuntime(),
      collaboration: { enabled: true, store },
    });
    const author = new RelayClient(connection(server.port, "human:author", "human"));
    const observer = new RelayClient(connection(server.port, "agent:observer", "agent"));
    const documents: Y.Doc[] = [];
    try {
      const created = await author.invoke("journey.create", {
        expectedRevision: 0,
        title: "Bootstrap projection",
        steps: [],
      });
      await author.bootstrapCollaboration(created.journey.id);

      // Use a fresh journey for the Authoring Session while retaining the
      // already-open collaborative document contract on that same journey.
      const initial = await author.journey(created.journey.id);
      await author.saveDevicePool({
        id: "projection-pool",
        name: "Projection devices",
        platform: "android",
        deviceSerials: ["device-projection"],
      });
      const lease = await author.lease({
        poolId: "projection-pool",
        deviceSerial: "device-projection",
        expiresAt: Date.now() + 60_000,
      });
      let session = (
        await author.createAuthoringSession({
          journeyId: created.journey.id,
          target: { kind: "device", platform: "android", targetId: "device-projection" },
          leaseId: lease.lease.id,
          expectedJourneyRevision: initial.revision,
          expectedRecipeRevision: created.journey.updatedAt,
        })
      ).session;
      session = (await author.observeAuthoringSession(session.id)).session;
      session = (await author.startAuthoringSession(session.id)).session;
      session = (await author.interactAuthoringSession(session.id, { kind: "key", key: "back" }))
        .session;
      session = (await author.stopAuthoringSession(session.id)).session;
      session = (await author.replayAuthoringTake(session.id)).session;
      session = (
        await author.commitAuthoringSession({
          sessionId: session.id,
          destination: { kind: "new-screen", title: "Destination" },
        })
      ).session;

      const canonical = await author.journey(created.journey.id);
      const canonicalTransition = canonical.value.graph?.transitions.find(
        ({ id }) => id === session.committedTransitionId,
      );
      assert.ok(canonicalTransition);
      assert.equal(canonicalTransition.state, "recorded");
      assert.equal(canonicalTransition.review?.status, "verified");
      assert.ok(canonicalTransition.stepIds.length > 0);
      assert.ok(canonicalTransition.evidenceIds?.length);
      assert.ok(canonicalTransition.takeId);

      const peer = new Y.Doc();
      documents.push(peer);
      const sync = await observer.syncCollaboration(
        created.journey.id,
        Buffer.from(encodeCollaborativeJourneyStateVector(peer)).toString("base64"),
      );
      applyCollaborativeJourneyUpdate(peer, bytes(sync.updateBase64), "peer-sync");
      const collaborative = materializeCollaborativeJourney(peer);
      const projected = collaborative.graph?.transitions.find(
        ({ id }) => id === session.committedTransitionId,
      );
      assert.ok(projected);
      assert.deepEqual(projected.stepIds, []);
      assert.equal(projected.state, "needs-recording");
      assert.equal(projected.evidenceIds, undefined);
      assert.equal(projected.review, undefined);
      assert.equal(projected.takeId, undefined);
      assert.equal(projected.videoTakeId, undefined);
      assert.equal(projected.videoClip, undefined);
      assert.equal(collaborative.takes, undefined);
      assert.equal(collaborative.review, undefined);

      const destinationId =
        projected.destination.kind === "screen" ? projected.destination.screenId : undefined;
      assert.ok(destinationId);
      const renameVector = encodeCollaborativeJourneyStateVector(peer);
      peer.transact(() => {
        getCollaborativeJourneyEntityMap(peer, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens)
          .get(destinationId)!
          .set("title", "Collaboratively renamed");
      }, "collaborative-rename");
      await observer.appendCollaborationUpdate(
        created.journey.id,
        Buffer.from(encodeCollaborativeJourneyUpdate(peer, renameVector)).toString("base64"),
        "observer:rename-1",
      );

      const retry = await createCollaborationRouteService({ store }).projectCanonicalJourney({
        scope: {
          organizationId: "local",
          projectId: "project-projection",
          journeyId: created.journey.id,
        },
        metadata: canonical.value,
        causationId: session.id,
      });
      assert.deepEqual(retry, { applied: false, duplicate: true, updateBytes: 0 });
      const retryPeer = new Y.Doc();
      documents.push(retryPeer);
      const retrySync = await observer.syncCollaboration(
        created.journey.id,
        Buffer.from(encodeCollaborativeJourneyStateVector(retryPeer)).toString("base64"),
      );
      applyCollaborativeJourneyUpdate(retryPeer, bytes(retrySync.updateBase64), "retry-sync");
      assert.equal(
        materializeCollaborativeJourney(retryPeer).graph?.screens.find(
          ({ id }) => id === destinationId,
        )?.title,
        "Collaboratively renamed",
      );

      const forgedVector = encodeCollaborativeJourneyStateVector(peer);
      peer.transact(() => {
        const stepIds = new Y.Array<string>();
        stepIds.push(["forged-step"]);
        getCollaborativeJourneyEntityMap(peer, COLLABORATIVE_JOURNEY_ROOT_KEYS.connections)
          .get(projected.id)!
          .set("stepIds", stepIds);
      }, "forged-client");
      await assert.rejects(
        () =>
          observer.appendCollaborationUpdate(
            created.journey.id,
            Buffer.from(encodeCollaborativeJourneyUpdate(peer, forgedVector)).toString("base64"),
            "forged:update-1",
          ),
        (error: unknown) => error instanceof ApiError && error.status === 422,
      );
    } finally {
      for (const document of documents) document.destroy();
      await server.close();
    }
  });
});

test("projection failure emits a bounded diagnostic without changing commit outcome", async () => {
  await withEnvironment(async (root) => {
    const local = new LocalCollaborativeJourneyStorageProvider({
      rootDirectory: join(root, "collaboration"),
    });
    const storage: CollaborativeJourneyStorageProvider = {
      load: (scope, maximumUpdateBytes) => local.load(scope, maximumUpdateBytes),
      initialize: (scope, snapshot) => local.initialize(scope, snapshot),
      async append() {
        const error = new Error(`secret path: ${root}`) as Error & { code: string };
        error.code = "unsafe code with spaces";
        throw error;
      },
      compact: (scope, snapshot) => local.compact(scope, snapshot),
    };
    const store = new DurableCollaborativeJourneyStore({ storage });
    const events: DeviceEvent[] = [];
    const unsubscribe = subscribe((event) => events.push(event));
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      authoringRuntime: new ProjectionRuntime(),
      collaboration: { enabled: true, store },
    });
    const author = new RelayClient(connection(server.port, "human:fault", "human"));
    try {
      const created = await author.invoke("journey.create", {
        expectedRevision: 0,
        title: "Projection failure",
        steps: [],
      });
      await author.bootstrapCollaboration(created.journey.id);
      const initial = await author.journey(created.journey.id);
      await author.saveDevicePool({
        id: "projection-pool",
        name: "Projection devices",
        platform: "android",
        deviceSerials: ["device-projection"],
      });
      const lease = await author.lease({
        poolId: "projection-pool",
        deviceSerial: "device-projection",
        expiresAt: Date.now() + 60_000,
      });
      let session = (
        await author.createAuthoringSession({
          journeyId: created.journey.id,
          target: { kind: "device", platform: "android", targetId: "device-projection" },
          leaseId: lease.lease.id,
          expectedJourneyRevision: initial.revision,
          expectedRecipeRevision: created.journey.updatedAt,
        })
      ).session;
      session = (await author.observeAuthoringSession(session.id)).session;
      session = (await author.startAuthoringSession(session.id)).session;
      session = (await author.interactAuthoringSession(session.id, { kind: "key", key: "back" }))
        .session;
      session = (await author.stopAuthoringSession(session.id)).session;
      session = (await author.replayAuthoringTake(session.id)).session;
      session = (
        await author.commitAuthoringSession({
          sessionId: session.id,
          destination: { kind: "new-screen", title: "Still committed" },
        })
      ).session;

      assert.equal(session.state, "committed");
      const canonical = await author.journey(created.journey.id);
      const transition = canonical.value.graph?.transitions.find(
        ({ id }) => id === session.committedTransitionId,
      );
      assert.ok(transition);
      assert.equal(transition.state, "recorded");
      assert.equal(transition.review?.status, "verified");
      assert.ok(transition.stepIds.length > 0);

      const failure = events.find((event) => {
        const payload = event.payload as unknown as { type?: string; sessionId?: string };
        return (
          payload.type === "collaboration.materialization.failed" &&
          payload.sessionId === session.id
        );
      });
      assert.ok(failure);
      const diagnostic = (
        failure.payload as unknown as { diagnostic: { code: string; message: string } }
      ).diagnostic;
      assert.deepEqual(diagnostic, {
        code: "internal-error",
        message:
          "The canonical Take committed, but the collaborative canvas has not caught up yet.",
      });
      assert.ok(JSON.stringify(failure).length < 1_024);
      assert.doesNotMatch(JSON.stringify(failure), /secret path|relay-authoring-projection/);
    } finally {
      unsubscribe();
      await server.close();
    }
  });
});
