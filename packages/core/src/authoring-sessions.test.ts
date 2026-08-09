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
  recordedPauseDuration,
  type AuthoringRuntime,
} from "./authoring-sessions.js";
import { runWithOperationContext, type OperationContext } from "./operation-context.js";
import { commitAppMapChanges } from "./app-map.js";
import { createAppMap, mutateStoredAppMap, readAppMap } from "./collaboration.js";

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
  nodesByScreen = new Map<
    string,
    Array<{ role: string; label?: string; identifier?: string; enabled?: boolean }>
  >();
  observations = 0;
  lifecycle: string[] = [];
  executed: AuthoringInteraction[] = [];
  replayed: RecipeStep[][] = [];
  failReplay = false;
  replayScreen = "destination";

  async observe() {
    this.lifecycle.push("observe");
    this.observations += 1;
    const capturedAt = 1_000 + this.observations;
    return {
      capturedAt,
      targetId: "device-a",
      fingerprint: createHash("sha256").update(this.screen).digest("hex"),
      bounds: { width: 400, height: 800 },
      nodes: this.nodesByScreen.get(this.screen) ?? [{ role: "button", label: this.screen }],
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
    if (steps.length > 0) this.screen = this.replayScreen;
  }

  async startVideo() {
    this.lifecycle.push("start-video");
  }

  async stopVideo() {
    this.lifecycle.push("stop-video");
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
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(directory, "state");
  process.env.RELAY_RECIPES_DIR = join(directory, "recipes");
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
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
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

test("recorded pauses ignore scheduling noise, stay readable, and bound forgotten recordings", () => {
  assert.equal(recordedPauseDuration(199), 0);
  assert.equal(recordedPauseDuration(224), 200);
  assert.equal(recordedPauseDuration(226), 250);
  assert.equal(recordedPauseDuration(1_234), 1_250);
  assert.equal(recordedPauseDuration(90_000), 10_000);
  assert.equal(recordedPauseDuration(Number.NaN), 0);
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

test("screen capture persists evidence without starting video recording", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    const created = await store.create({
      appMapId,
      target: { kind: "device", platform: "ios", targetId: "ipad-a" },
      leaseId: "lease-a",
      expectedAppMapRevision: appMap.revision,
    });

    const captured = await store.capture(created.id, runtime);

    assert.equal(captured.state, "reviewing");
    assert.deepEqual(runtime.lifecycle, ["observe"]);
    const revision = captured.take?.revisions[0];
    assert.ok(revision?.before);
    assert.deepEqual(revision?.after, revision?.before);
    assert.equal(revision?.actions.length, 0);
    assert.ok(revision?.evidence.some((item) => item.kind === "screenshot"));
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

test("stopping without an action cancels the empty take instead of opening review", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.stop(session.id, runtime);

    assert.equal(session.state, "cancelled");
    assert.equal(session.take?.state, "discarded");
    assert.equal(session.take?.revisions.at(-1)?.actions.length, 0);
    assert.deepEqual(runtime.lifecycle, [
      "observe",
      "observe",
      "start-video",
      "stop-video",
      "observe",
    ]);
  });
});

test("the session routes every supported control and evidence-only interaction", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    const interactions: AuthoringInteraction[] = [
      { kind: "tap", target: { label: "Continue" } },
      { kind: "type", text: "hello" },
      { kind: "clipboard", action: "write", text: "hello\nworld" },
      { kind: "clipboard", action: "paste", text: "hello\nworld", target: { label: "Message" } },
      { kind: "clipboard", action: "copy", target: { label: "Message" } },
      { kind: "app", action: "switcher" },
      { kind: "device", action: "keyboard-dismiss" },
      { kind: "rotate", orientation: "landscape-left" },
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
    runtime.lifecycle = [];
    session = await store.stop(session.id, runtime);
    assert.deepEqual(runtime.lifecycle.slice(0, 2), ["stop-video", "observe"]);
    const revision = session.take!.revisions.at(-1)!;
    assert.equal(revision.actions.length, interactions.length);
    assert.deepEqual(
      runtime.executed.map((interaction) => interaction.kind),
      [
        "tap",
        "type",
        "clipboard",
        "clipboard",
        "clipboard",
        "app",
        "device",
        "rotate",
        "swipe",
        "key",
        "wait",
      ],
    );
    assert.equal(revision.actions[12]?.steps.length, 0);
    assert.equal(revision.actions[12]?.label, "Checkpoint");
    assert.equal(revision.actions[13]?.steps.length, 0);
    assert.ok(revision.actions.every((action) => action.evidenceIds.length > 0));
  });
});

test("human pauses become editable replay steps instead of hidden timing", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    await new Promise((resolve) => setTimeout(resolve, 230));
    session = await store.interact(session.id, { kind: "key", key: "back" }, runtime);
    // Reviewing the destination before pressing Stop is not part of replay.
    await new Promise((resolve) => setTimeout(resolve, 230));
    session = await store.stop(session.id, runtime);

    const revision = session.take!.revisions.at(-1)!;
    const pauses = revision.actions.filter((action) => action.label === "Recorded pause");
    assert.equal(pauses.length, 1);
    const pause = pauses[0];
    assert.ok(pause);
    assert.equal(pause.steps[0]?.kind, "sleep");
    assert.ok(pause.steps[0]?.kind === "sleep" && pause.steps[0].ms >= 200);

    session = await store.replace(session.id, pause.id, { kind: "wait", ms: 100 });
    const editedPause = session
      .take!.revisions.at(-1)!
      .actions.find((action) => action.id === pause.id);
    assert.equal(editedPause?.label, undefined);
    assert.deepEqual(editedPause?.steps, [
      { id: `${pause.id}-step-1`, group: "Settings", kind: "sleep", ms: 100 },
    ]);

    runtime.screen = "source";
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");
    assert.ok(runtime.replayed.at(-1)?.some((step) => step.kind === "sleep"));
  });
});

test("agent orchestration gaps never become replay delays", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    const agentOperation = {
      ...operation("authoring.agent-pauses"),
      actorId: "agent:test",
      actorKind: "agent" as const,
    };
    await runWithOperationContext(agentOperation, async () => {
      let session = await store.create({
        appMapId,
        target: { kind: "device", platform: "android", targetId: "device-a" },
        leaseId: "lease-a",
        expectedAppMapRevision: 0,
        group: "Settings",
      });
      session = await store.observe(session.id, runtime);
      session = await store.start(session.id, runtime);
      session = await store.interact(
        session.id,
        { kind: "tap", target: { label: "Continue" } },
        runtime,
      );
      await new Promise((resolve) => setTimeout(resolve, 230));
      session = await store.interact(session.id, { kind: "key", key: "back" }, runtime);

      assert.equal(
        session.take!.revisions.at(-1)!.actions.some((action) => action.label === "Recorded pause"),
        false,
      );
    });
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
    assert.equal(runtime.executed.at(-1)?.kind, "steps");
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
      kind: "steps",
      label: "Automatic",
      applied: true,
      steps: [{ kind: "sleep", ms: 10 }],
    });
    assert.equal(session.take!.revisions.at(-1)?.actions[0]?.label, "Automatic");
    session = await store.trim(session.id, { actionIds: reversed.slice(0, 3), fromMs: 0 });
    assert.equal(session.take!.revisions.length, originalRevisions + 3);
    assert.equal(session.take!.revisions[originalRevisions - 1]?.actions.length, 4);
    assert.equal(session.take!.revisions.at(-1)?.actions.length, 3);

    runtime.failReplay = true;
    runtime.screen = "source";
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "failed");
    runtime.failReplay = false;
    runtime.screen = "source";
    runtime.replayScreen = "source";
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "failed");
    assert.match(session.take!.replayAttempts.at(-1)?.error ?? "", /landed on|different screen/);
    runtime.screen = "source";
    runtime.replayScreen = "destination";
    session = await store.replay(session.id, runtime);
    assert.deepEqual(
      session.take!.replayAttempts.map((attempt) => attempt.outcome),
      ["passed", "failed", "failed", "passed"],
    );
    const immutableFirst = structuredClone(session.take!.replayAttempts[0]);

    session = await store.commit(session.id, {
      destination: { kind: "new-screen", title: "Home" },
    });
    assert.equal(session.state, "committed");
    assert.deepEqual(session.take!.replayAttempts[0], immutableFirst);
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

test("replay accepts a stable application shell when generated destination content changes", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    runtime.nodesByScreen.set("destination", [
      { role: "header", identifier: "conversation_top_bar", enabled: true },
      { role: "textbox", identifier: "chat_text_input", enabled: true },
      { role: "button", label: "Copy message", enabled: true },
      { role: "button", label: "Share this conversation", enabled: true },
      { role: "text", label: "The first generated answer", enabled: true },
    ]);
    runtime.nodesByScreen.set("replayed-destination", [
      { role: "header", identifier: "conversation_top_bar", enabled: true },
      { role: "textbox", identifier: "chat_text_input", enabled: true },
      { role: "button", label: "Copy message", enabled: true },
      { role: "button", label: "Share this conversation", enabled: true },
      { role: "text", label: "A different generated answer", enabled: true },
    ]);
    runtime.nodesByScreen.set("blank-shell", [
      { role: "header", identifier: "conversation_top_bar", enabled: true },
      { role: "textbox", identifier: "chat_text_input", enabled: true },
      { role: "button", label: "Start new chat", enabled: true },
      { role: "text", label: "Ask anything", enabled: true },
    ]);

    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "tap", target: { label: "Send" } }, runtime);
    session = await store.stop(session.id, runtime);

    runtime.screen = "source";
    runtime.replayScreen = "replayed-destination";
    session = await store.replay(session.id, runtime);

    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");

    runtime.screen = "source";
    runtime.replayScreen = "blank-shell";
    session = await store.replay(session.id, runtime);

    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "failed");
  });
});

test("an edited planned connection adopts the successfully replayed destination", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    const sourceFingerprint = createHash("sha256").update("source").digest("hex");
    const prepared = await mutateStoredAppMap("project-a", appMapId, (current) => {
      const at = Date.now();
      const scope = {
        organizationId: current.organizationId,
        projectId: current.projectId,
        appMapId: current.id,
      };
      return commitAppMapChanges(
        current,
        [
          {
            kind: "screen.add",
            input: {
              screen: {
                ...scope,
                id: "source-screen",
                title: "Source",
                identity: { schemaVersion: 1, fingerprint: sourceFingerprint },
                variantIds: [],
                createdAt: at,
                updatedAt: at,
              },
            },
          },
          {
            kind: "screen.add",
            input: {
              screen: {
                ...scope,
                id: "planned-screen",
                title: "Planned destination",
                variantIds: [],
                createdAt: at,
                updatedAt: at,
              },
            },
          },
          {
            kind: "connection.create",
            connection: {
              ...scope,
              id: "planned-connection",
              fromScreenId: "source-screen",
              destination: { kind: "screen", screenId: "planned-screen" },
              state: "draft",
              actions: [],
              createdAt: at,
              updatedAt: at,
            },
          },
        ],
        undefined,
        {
          expectedRevision: current.revision,
          eventId: "planned-fixture",
          actorId: "human:test",
          actorKind: "human",
          at,
        },
      );
    });
    let session = await store.create({
      appMapId,
      target: { kind: "device", platform: "android", targetId: "device-a" },
      leaseId: "lease-a",
      expectedAppMapRevision: prepared.revision,
      sourceScreenId: "source-screen",
      pendingConnectionId: "planned-connection",
      group: "Settings",
    });
    session = await store.observe(session.id, runtime);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { point: { x: 20, y: 20 } } },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    const actionId = session.take!.revisions.at(-1)!.actions[0]!.id;

    session = await store.replace(session.id, actionId, {
      kind: "tap",
      target: { point: { x: 40, y: 40 } },
    });
    runtime.screen = "source";
    runtime.replayScreen = "edited-destination";
    session = await store.replay(session.id, runtime);

    const replay = session.take!.replayAttempts.at(-1);
    assert.equal(replay?.outcome, "passed");
    assert.equal(
      replay?.after?.screen.fingerprint,
      createHash("sha256").update("edited-destination").digest("hex"),
    );

    session = await store.commit(session.id, {});
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    const connection = appMap.connections[session.committedConnectionId!];
    assert.equal(connection?.id, "planned-connection");
    assert.equal(connection?.destination.kind, "screen");
    const destination =
      connection?.destination.kind === "screen"
        ? appMap.screens[connection.destination.screenId]
        : undefined;
    assert.equal(
      destination?.identity?.fingerprint,
      createHash("sha256").update("edited-destination").digest("hex"),
    );
  });
});

test("an unedited live demonstration can be committed without a second pass", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");
    assert.equal(runtime.replayed.length, 0);

    session = await store.commit(session.id, {
      destination: { kind: "new-screen", title: "Home" },
    });
    assert.equal(session.state, "committed");
    const appMap = await readAppMap("project-a", appMapId);
    const connection = appMap?.connections[session.committedConnectionId!];
    assert.equal(connection?.state, "ready");
    assert.equal(connection?.actions[0]?.kind, "recorded");
  });
});

test("a tap that never leaves the source screen cannot become a new destination", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    runtime.execute = async (_session, interaction) => {
      runtime.executed.push(interaction);
    };
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "App Language" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");
    await assert.rejects(
      store.commit(session.id, { destination: { kind: "new-screen", title: "App Language" } }),
      /did not leave the source screen/,
    );
  });
});

test("editing a Take still requires a successful replay before commit", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    const actionId = session.take!.revisions.at(-1)!.actions[0]!.id;
    session = await store.replace(session.id, actionId, {
      kind: "tap",
      target: { label: "Next" },
    });
    await assert.rejects(
      store.commit(session.id, { destination: { kind: "new-screen", title: "Home" } }),
      /Replay the current Take successfully/,
    );

    runtime.screen = "source";
    runtime.replayScreen = "destination";
    session = await store.replay(session.id, runtime);
    session = await store.commit(session.id, {
      destination: { kind: "new-screen", title: "Home" },
    });
    assert.equal(session.state, "committed");
  });
});

test("a zero-action Take cannot manufacture an observe-only path", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.stop(session.id, runtime);
    assert.equal(session.state, "cancelled");
    await assert.rejects(store.replay(session.id, runtime), /expected reviewing/);
    await assert.rejects(store.commit(session.id, {}), /expected reviewing/);
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    assert.equal(Object.keys(appMap.connections).length, 0);
  });
});

test("recording from a mapped screen refuses to corrupt it with another device state", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let first = await createReadySession(store, runtime, appMapId);
    first = await store.start(first.id, runtime);
    first = await store.interact(first.id, { kind: "key", key: "back" }, runtime);
    first = await store.stop(first.id, runtime);
    runtime.screen = "source";
    first = await store.replay(first.id, runtime);
    first = await store.commit(first.id, {});

    const map = await readAppMap("project-a", appMapId);
    assert.ok(map);
    const sourceScreenId = map.connections[first.committedConnectionId!]?.fromScreenId;
    assert.ok(sourceScreenId);

    runtime.screen = "unrelated-app";
    let next = await store.create({
      appMapId,
      target: { kind: "device", platform: "android", targetId: "device-a" },
      leaseId: "lease-a",
      expectedAppMapRevision: map.revision,
      sourceScreenId,
    });
    next = await store.observe(next.id, runtime);
    assert.equal(next.state, "ready");
    next = await store.start(next.id, runtime);
    assert.equal(next.state, "failed");
    assert.match(next.error ?? "", /Navigate the device to “Start”/);
    assert.equal(next.take, undefined);

    const unchanged = await readAppMap("project-a", appMapId);
    assert.deepEqual(
      unchanged?.screens[sourceScreenId]?.identity,
      map.screens[sourceScreenId]?.identity,
    );
  });
});

test("recording accepts the same mapped shell when only dynamic source content changes", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    runtime.nodesByScreen.set("source", [
      { role: "header", identifier: "conversation_top_bar", enabled: true },
      { role: "textbox", identifier: "chat_text_input", enabled: true },
      { role: "button", label: "New conversation", enabled: true },
      { role: "button", label: "Send", enabled: true },
      { role: "text", label: "Suggested prompt A", enabled: true },
    ]);
    runtime.nodesByScreen.set("source-dynamic", [
      { role: "header", identifier: "conversation_top_bar", enabled: true },
      { role: "textbox", identifier: "chat_text_input", enabled: true },
      { role: "button", label: "New conversation", enabled: true },
      { role: "button", label: "Send", enabled: true },
      { role: "text", label: "Suggested prompt B", enabled: true },
    ]);

    let first = await createReadySession(store, runtime, appMapId);
    first = await store.start(first.id, runtime);
    first = await store.interact(first.id, { kind: "key", key: "back" }, runtime);
    first = await store.stop(first.id, runtime);
    runtime.screen = "source";
    first = await store.replay(first.id, runtime);
    first = await store.commit(first.id, {});

    const map = await readAppMap("project-a", appMapId);
    assert.ok(map);
    const sourceScreenId = map.connections[first.committedConnectionId!]?.fromScreenId;
    assert.ok(sourceScreenId);

    runtime.screen = "source-dynamic";
    let next = await store.create({
      appMapId,
      target: { kind: "device", platform: "android", targetId: "device-a" },
      leaseId: "lease-a",
      expectedAppMapRevision: map.revision,
      sourceScreenId,
    });
    next = await store.observe(next.id, runtime);
    next = await store.start(next.id, runtime);

    assert.equal(next.state, "recording");
    assert.ok(next.take);
  });
});

test("later atomic commits retain evidence for every existing graph connection", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let first = await createReadySession(store, runtime, appMapId);
    first = await store.start(first.id, runtime);
    first = await store.interact(first.id, { kind: "key", key: "back" }, runtime);
    first = await store.stop(first.id, runtime);
    runtime.screen = "source";
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
    runtime.screen = "destination";
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
    assert.equal(released, 0);
    assert.equal(reconciled, 1);

    session = await store.observe(session.id, runtime);
    assert.equal(session.state, "reviewing");
    assert.equal(session.take?.state, "reviewing");
    runtime.screen = "source";
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

test("concurrent recovery is idempotent after a session becomes terminal", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);

    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstIsReconciling = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });

    const first = store.recover({
      async releaseLease() {},
      async reconcileRecording() {
        firstEntered();
        await firstCanFinish;
      },
    });
    await firstIsReconciling;
    const second = store.recover({ async releaseLease() {} });
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(
      [...firstResult, ...secondResult].map((value) => value.id),
      [session.id],
    );
    assert.equal((await store.get(session.id)).state, "failed");
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
    assert.equal(released.length, 0);

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
    assert.deepEqual(released, []);
    assert.deepEqual(await store.recoveryScopes(), []);
  });
});
