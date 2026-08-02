import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AuthoringInteraction, RecipeStep } from "@relay/protocol";
import {
  AuthoringSessionStore,
  AuthoringStateError,
  assertAuthoringTransition,
  type AuthoringRuntime,
} from "./authoring-sessions.js";
import { runWithOperationContext, type OperationContext } from "./operation-context.js";
import { createAppMap, readAppMap } from "./collaboration.js";

function operation(operationId = "authoring.test"): OperationContext {
  const requestId = crypto.randomUUID();
  return {
    schemaVersion: 1,
    actorId: "human:test",
    actorKind: "human",
    organizationId: "local",
    projectId: "project-a",
    operationId,
    requestId,
    idempotencyKey: requestId,
    issuedAt: Date.now(),
  };
}

class FakeRuntime implements AuthoringRuntime {
  screen = "source";
  observations = 0;
  executed: AuthoringInteraction[] = [];
  replayed: RecipeStep[][] = [];
  failReplay = false;

  async observe() {
    this.observations += 1;
    const capturedAt = 1_000 + this.observations;
    return {
      capturedAt,
      targetId: "device-a",
      fingerprint: createHash("sha256").update(this.screen).digest("hex"),
      bounds: { width: 400, height: 800 },
      nodes: [{ role: "button", label: this.screen }],
      screenshot: { data: Buffer.from(`png:${this.screen}:${capturedAt}`), mime: "image/png" },
    };
  }

  async execute(_session: unknown, interaction: AuthoringInteraction) {
    this.executed.push(interaction);
    if (interaction.kind === "key" || interaction.kind === "tap") this.screen = "destination";
  }

  async replay(_session: unknown, steps: RecipeStep[]) {
    this.replayed.push(structuredClone(steps));
    if (this.failReplay) throw new Error("replay failed");
  }

  async startVideo() {}

  async stopVideo() {
    return { data: Buffer.from("video"), mime: "video/mp4" };
  }
}

async function withWorkspace(
  run: (input: {
    store: AuthoringSessionStore;
    runtime: FakeRuntime;
    appMapId: string;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "relay-authoring-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    recipes: process.env.GROK_DEVICE_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(directory, "state");
  process.env.GROK_DEVICE_RECIPES_DIR = join(directory, "recipes");
  process.env.RELAY_TESTS_DIR = join(directory, "tests");
  try {
    await runWithOperationContext(operation("app-map.create"), async () => {
      const appMap = await createAppMap({
        organizationId: "local",
        projectId: "project-a",
        appMapId: "authoring-map",
        name: "Authoring",
      });
      await run({
        store: new AuthoringSessionStore(),
        runtime: new FakeRuntime(),
        appMapId: appMap.id,
      });
    });
  } finally {
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.recipes === undefined) delete process.env.GROK_DEVICE_RECIPES_DIR;
    else process.env.GROK_DEVICE_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(directory, { recursive: true, force: true });
  }
}

async function createReadySession(
  store: AuthoringSessionStore,
  runtime: FakeRuntime,
  appMapId: string,
) {
  const appMap = await readAppMap("project-a", appMapId);
  assert.ok(appMap);
  let session = await store.create({
    appMapId,
    target: { kind: "device", platform: "android", targetId: "device-a" },
    leaseId: "lease-a",
    expectedAppMapRevision: appMap.revision,
    group: "Settings",
  });
  session = await store.observe(session.id, runtime);
  return session;
}

test("state machine permits only explicit lifecycle edges", () => {
  const allowed = new Set([
    "preparing:ready",
    "preparing:failed",
    "preparing:cancelled",
    "ready:recording",
    "ready:cancelled",
    "ready:failed",
    "recording:reviewing",
    "recording:failed",
    "recording:cancelled",
    "reviewing:committing",
    "reviewing:cancelled",
    "reviewing:failed",
    "committing:committed",
    "committing:reviewing",
    "committing:failed",
    "failed:ready",
    "failed:reviewing",
    "failed:cancelled",
  ]);
  const states = [
    "preparing",
    "ready",
    "recording",
    "reviewing",
    "committing",
    "committed",
    "failed",
    "cancelled",
  ] as const;
  for (const from of states) {
    for (const to of states) {
      if (allowed.has(`${from}:${to}`)) {
        assert.doesNotThrow(() => assertAuthoringTransition(from, to));
      } else {
        assert.throws(() => assertAuthoringTransition(from, to), AuthoringStateError);
      }
    }
  }
});

test("sessions on different explicit targets progress independently", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    const first = await createReadySession(store, runtime, appMapId);
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    let second = await store.create({
      appMapId,
      target: { kind: "device", platform: "android", targetId: "device-b" },
      leaseId: "lease-b",
      expectedAppMapRevision: appMap.revision,
    });
    const secondRuntime = new FakeRuntime();
    second = await store.observe(second.id, secondRuntime);
    const recordingFirst = await store.start(first.id, runtime);
    const recordingSecond = await store.start(second.id, secondRuntime);
    await store.interact(recordingFirst.id, { kind: "key", key: "back" }, runtime);
    await store.interact(recordingSecond.id, { kind: "wait", ms: 1 }, secondRuntime);
    assert.equal((await store.get(recordingFirst.id)).target.targetId, "device-a");
    assert.equal((await store.get(recordingSecond.id)).target.targetId, "device-b");
    assert.equal(runtime.executed[0]?.kind, "key");
    assert.equal(secondRuntime.executed[0]?.kind, "wait");
  });
});

test("unsupported target interactions stay explicit and are not recorded", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    runtime.execute = async () => {
      throw new Error("Capability unavailable for swipe");
    };
    await assert.rejects(
      store.interact(
        session.id,
        { kind: "swipe", from: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
        runtime,
      ),
      /Capability unavailable for swipe/,
    );
    assert.equal((await store.get(session.id)).take?.revisions.at(-1)?.actions.length, 0);
  });
});

test("the session routes every supported control and evidence-only interaction", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    const interactions: AuthoringInteraction[] = [
      { kind: "tap", target: { label: "Continue" } },
      { kind: "type", text: "hello" },
      { kind: "swipe", from: { x: 10, y: 20 }, to: { x: 30, y: 40 }, durationMs: 120 },
      { kind: "key", key: "home" },
      { kind: "wait", ms: 5 },
      { kind: "wait", ms: 0 },
      { kind: "screenshot", label: "Checkpoint" },
      { kind: "observe", label: "Automatic transition" },
    ];
    for (const interaction of interactions) {
      session = await store.interact(session.id, interaction, runtime);
    }
    session = await store.stop(session.id, runtime);
    const revision = session.take!.revisions.at(-1)!;
    assert.equal(revision.actions.length, interactions.length);
    assert.deepEqual(
      runtime.executed.map((interaction) => interaction.kind),
      ["tap", "type", "swipe", "key", "wait"],
    );
    assert.equal(revision.actions[5]?.steps.length, 0);
    assert.equal(revision.actions[6]?.steps.length, 0);
    assert.equal(revision.actions[6]?.label, "Checkpoint");
    assert.ok(revision.actions.every((action) => action.evidenceIds.length > 0));
  });
});

test("Take revisions preserve Back, Wait/no-op, reusable, multi-action, replay, and evidence", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "key", key: "back" }, runtime);
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.interact(
      session.id,
      { kind: "reusable", recipeId: "shared-login", bindings: { user: "qa" } },
      runtime,
    );
    session = await store.interact(
      session.id,
      {
        kind: "steps",
        label: "Settle and return",
        steps: [
          { kind: "sleep", ms: 50 },
          { kind: "key", key: "home" },
        ],
      },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    assert.equal(session.state, "reviewing");
    const recorded = session.take!.revisions.at(-1)!;
    assert.equal(recorded.actions.length, 4);
    assert.equal(recorded.actions[1]!.steps.length, 0);
    assert.equal(recorded.actions[2]!.steps[0]?.kind, "module");
    assert.equal(recorded.actions[3]!.steps.length, 2);
    assert.ok(recorded.evidence.some((item) => item.kind === "video"));

    const originalRevisions = session.take!.revisions.length;
    const reversed = [...recorded.actions].reverse().map((action) => action.id);
    session = await store.reorder(session.id, reversed);
    session = await store.replace(session.id, reversed[0]!, {
      kind: "observe",
      label: "Automatic",
    });
    session = await store.trim(session.id, { actionIds: reversed.slice(0, 3), fromMs: 0 });
    assert.equal(session.take!.revisions.length, originalRevisions + 3);
    assert.equal(session.take!.revisions[originalRevisions - 1]?.actions.length, 4);
    assert.equal(session.take!.revisions.at(-1)?.actions.length, 3);

    runtime.failReplay = true;
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "failed");
    runtime.failReplay = false;
    runtime.screen = "source";
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "failed");
    assert.match(session.take!.replayAttempts.at(-1)?.error ?? "", /different screen/);
    runtime.screen = "destination";
    session = await store.replay(session.id, runtime);
    assert.deepEqual(
      session.take!.replayAttempts.map((attempt) => attempt.outcome),
      ["failed", "failed", "passed"],
    );
    const immutableFailed = structuredClone(session.take!.replayAttempts[0]);

    session = await store.commit(session.id, {
      destination: { kind: "new-screen", title: "Home" },
    });
    assert.equal(session.state, "committed");
    assert.deepEqual(session.take!.replayAttempts[0], immutableFailed);
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    const connection = appMap.connections[session.committedConnectionId!];
    assert.ok(connection);
    assert.equal(connection.state, "ready");
    assert.equal(connection.actions[0]?.kind, "recorded");
    assert.ok(
      connection.actions[0]?.kind === "recorded" && connection.actions[0].evidenceIds.length > 0,
    );
    assert.equal(appMap.activity[session.id]?.eventType, "recording.committed");
  });
});

test("a zero-action Take commits as an explicit verified observe-only edge", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.stop(session.id, runtime);
    session = await store.replay(session.id, runtime);
    session = await store.commit(session.id, {});
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    const connection = appMap.connections[session.committedConnectionId!];
    assert.deepEqual(connection?.actions, [
      { id: `passive-${session.take!.id}`, kind: "passive", reason: "observe-only" },
    ]);
    assert.equal(connection?.state, "ready");
    assert.equal(connection?.destination.kind, "screen");
    assert.equal(
      connection?.destination.kind === "screen" ? connection.destination.screenId : undefined,
      connection?.fromScreenId,
      "the canonical semantic identity merges an observe-only cycle back to its source Screen",
    );
  });
});

test("later atomic commits retain evidence for every existing graph connection", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let first = await createReadySession(store, runtime, appMapId);
    first = await store.start(first.id, runtime);
    first = await store.interact(first.id, { kind: "key", key: "back" }, runtime);
    first = await store.stop(first.id, runtime);
    first = await store.replay(first.id, runtime);
    first = await store.commit(first.id, {});

    const current = await readAppMap("project-a", appMapId);
    assert.ok(current);
    let second = await store.create({
      appMapId,
      target: { kind: "device", platform: "android", targetId: "device-a" },
      leaseId: "lease-a",
      expectedAppMapRevision: current.revision,
    });
    second = await store.observe(second.id, runtime);
    second = await store.start(second.id, runtime);
    second = await store.interact(second.id, { kind: "wait", ms: 1 }, runtime);
    second = await store.stop(second.id, runtime);
    second = await store.replay(second.id, runtime);
    await store.commit(second.id, {});

    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    assert.equal(Object.keys(appMap.connections).length, 2);
    for (const connection of Object.values(appMap.connections)) {
      const recorded = connection.actions.find((action) => action.kind === "recorded");
      assert.ok(recorded && recorded.evidenceIds.length > 0);
    }
  });
});

test("recovery preserves interrupted recording and resolves post-rename commits", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "key", key: "back" }, runtime);
    let released = 0;
    let reconciled = 0;
    const recovered = await store.recover({
      async releaseLease() {
        released += 1;
      },
      async reconcileRecording() {
        reconciled += 1;
      },
    });
    assert.equal(recovered[0]?.state, "failed");
    assert.equal(recovered[0]?.recoverable, true);
    assert.ok(recovered[0]?.take?.revisions.at(-1)?.actions.length);
    assert.equal(released, 1);
    assert.equal(reconciled, 1);

    session = await store.observe(session.id, runtime);
    assert.equal(session.state, "reviewing");
    session = await store.replay(session.id, runtime);
    await assert.rejects(
      store.commit(session.id, {}, (boundary) => {
        if (boundary === "after-rename") throw new Error("simulated process death");
      }),
      /simulated process death/,
    );
    assert.equal((await store.get(session.id)).state, "committing");
    const afterCommitRecovery = await store.recover({ async releaseLease() {} });
    assert.equal(afterCommitRecovery[0]?.state, "committed");
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    const activity = appMap.activity[session.id];
    assert.equal(activity?.eventType, "recording.committed");
    assert.ok(activity && appMap.connections[activity.subject.id]);
  });
});

test("startup recovery scopes every persisted project without crossing project ownership", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let projectA = await createReadySession(store, runtime, appMapId);
    projectA = await store.start(projectA.id, runtime);

    const projectBContext = { ...operation("authoring.project-b"), projectId: "project-b" };
    const projectB = await runWithOperationContext(projectBContext, async () => {
      const appMap = await createAppMap({
        organizationId: "local",
        projectId: "project-b",
        appMapId,
        name: "Authoring",
      });
      let session = await store.create({
        appMapId,
        target: { kind: "device", platform: "android", targetId: "device-b" },
        leaseId: "lease-b",
        expectedAppMapRevision: appMap.revision,
      });
      session = await store.observe(session.id, runtime);
      return store.start(session.id, runtime);
    });

    assert.deepEqual(await store.recoveryScopes(), [
      { organizationId: "local", projectId: "project-a" },
      { organizationId: "local", projectId: "project-b" },
    ]);

    const released: string[] = [];
    const recoveredA = await store.recover({
      async releaseLease(session) {
        released.push(session.leaseId);
      },
    });
    assert.deepEqual(
      recoveredA.map((session) => session.id),
      [projectA.id],
    );
    assert.deepEqual(released, ["lease-a"]);

    await runWithOperationContext(projectBContext, async () => {
      assert.equal((await store.get(projectB.id)).state, "recording");
      const recoveredB = await store.recover({
        async releaseLease(session) {
          released.push(session.leaseId);
        },
      });
      assert.deepEqual(
        recoveredB.map((session) => session.id),
        [projectB.id],
      );
    });
    assert.deepEqual(released, ["lease-a", "lease-b"]);
    assert.deepEqual(await store.recoveryScopes(), []);
  });
});
