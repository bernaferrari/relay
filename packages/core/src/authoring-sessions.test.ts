import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AUTHORING_RAW_CAPTURE_VERSION,
  summarizeAuthoringSession,
  type AuthoringCaptureContext,
  type AuthoringInteraction,
  type RecipeStep,
} from "@relay/protocol";
import {
  AuthoringSessionStore,
  AuthoringStateError,
  assertAuthoringTransition,
  recordedPauseDuration,
  type CapturedAuthoringObservation,
  type AuthoringRuntime,
} from "./authoring-sessions.js";
import { runWithOperationContext, type OperationContext } from "./operation-context.js";
import { commitAppMapChanges } from "./app-map.js";
import { createAppMap, mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import { MAX_AUTHORING_RETAINED_OBSERVATIONS } from "./authoring-observation-links.js";
import {
  appendAuthoringRawInteractionIntent,
  pendingAuthoringRawInteractionIntents,
} from "./authoring-raw-recording.js";

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
  replayedActions: string[] = [];
  replayEndpointCaptures = 0;
  replayEndpointSemantics: "current" | "stale" | "unavailable" = "unavailable";
  fullObservationSemantics?: "current" | "stale" | "unavailable";
  fullCapture?: AuthoringCaptureContext;
  failReplay = false;
  replayScreen = "destination";
  prepareReplaySource?: AuthoringRuntime["prepareReplaySource"];
  replayAction?: AuthoringRuntime["replayAction"];
  observeReplayActionEndpoint?: AuthoringRuntime["observeReplayActionEndpoint"];

  async observe(): Promise<CapturedAuthoringObservation> {
    this.lifecycle.push("observe");
    this.observations += 1;
    const capturedAt = 1_000 + this.observations;
    const fingerprint = createHash("sha256").update(this.screen).digest("hex");
    const semantics = this.fullObservationSemantics;
    return {
      capturedAt,
      targetId: "device-a",
      fingerprint,
      bounds: { width: 400, height: 800 },
      nodes: this.nodesByScreen.get(this.screen) ?? [{ role: "button", label: this.screen }],
      ...(semantics
        ? {
            proof: {
              schemaVersion: 1 as const,
              captureOrder: "concurrent" as const,
              pixels: { status: "captured" as const, capturedAt, fingerprint },
              semantics:
                semantics === "current"
                  ? { status: "current" as const, capturedAt, fingerprint }
                  : { status: semantics, capturedAt },
            },
          }
        : {}),
      ...(this.fullCapture ? { capture: structuredClone(this.fullCapture) } : {}),
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

  async immediateReplayEndpoint() {
    this.replayEndpointCaptures += 1;
    const capturedAt = 10_000 + this.replayEndpointCaptures;
    const fingerprint = createHash("sha256").update(this.screen).digest("hex");
    const semantics = this.replayEndpointSemantics;
    return {
      capturedAt,
      targetId: "device-a",
      fingerprint,
      bounds: { width: 400, height: 800 },
      ...(semantics === "current"
        ? { nodes: this.nodesByScreen.get(this.screen) ?? [{ role: "button", label: this.screen }] }
        : {}),
      proof: {
        schemaVersion: 1 as const,
        captureOrder: "pixels-first" as const,
        pixels: { status: "captured" as const, capturedAt, fingerprint, width: 400, height: 800 },
        semantics:
          semantics === "current"
            ? { status: "current" as const, capturedAt, fingerprint }
            : { status: semantics, capturedAt },
      },
      screenshot: {
        data: Buffer.from(`png:endpoint:${this.screen}:${capturedAt}`),
        mime: "image/png",
      },
    };
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
    testName: "Settings localization",
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

test("a replacement review archives the older Take durably while retaining its evidence history", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let first = await createReadySession(store, runtime, appMapId);
    first = await store.start(first.id, runtime);
    first = await store.interact(first.id, { kind: "observe", label: "First review" }, runtime);
    first = await store.stop(first.id, runtime);
    const firstEvidence = structuredClone(first.take!.revisions.at(-1)!.evidence);

    let replacement = await createReadySession(store, runtime, appMapId);
    replacement = await store.start(replacement.id, runtime);
    replacement = await store.interact(
      replacement.id,
      { kind: "observe", label: "Replacement review" },
      runtime,
    );
    replacement = await store.stop(replacement.id, runtime);

    const restartedStore = new AuthoringSessionStore();
    const archived = await restartedStore.get(first.id);
    assert.deepEqual(archived.archive, {
      reason: "superseded",
      archivedAt: archived.updatedAt,
      supersededBySessionId: replacement.id,
    });
    assert.deepEqual(archived.take?.revisions.at(-1)?.evidence, firstEvidence);
    assert.deepEqual(
      (await restartedStore.list("project-a")).map((session) => session.id),
      [replacement.id],
    );
    assert.deepEqual(
      (await restartedStore.list("project-a", { includeHistory: true }))
        .map((session) => session.id)
        .sort(),
      [first.id, replacement.id].sort(),
    );
  });
});

test("recorded pauses ignore scheduling noise, stay readable, and bound forgotten recordings", () => {
  assert.equal(recordedPauseDuration(199), 0);
  assert.equal(recordedPauseDuration(224), 200);
  assert.equal(recordedPauseDuration(226), 250);
  assert.equal(recordedPauseDuration(1_234), 1_250);
  assert.equal(recordedPauseDuration(90_000), 10_000);
  assert.equal(recordedPauseDuration(Number.NaN), 0);
});

test("authoring snapshot evidence keeps proof and capture provenance for offline analysis", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    runtime.fullObservationSemantics = "current";
    runtime.fullCapture = {
      snapshotSource: "sdk",
      inspectable: true,
      inspectionState: "active",
      bindingState: "matched",
      treeApp: "com.example.product",
      visualFingerprint: "visual-source",
    };
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);

    const revision = session.take!.revisions.at(-1)!;
    const snapshot = revision.evidence.find((evidence) => evidence.kind === "snapshot");
    assert.ok(snapshot?.sha256);
    const payload = JSON.parse((await readAuthoringEvidence(snapshot.sha256))!.toString("utf8"));

    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.capturedAt, snapshot.capturedAt);
    assert.equal(payload.targetId, "device-a");
    assert.deepEqual(payload.proof, revision.before?.proof);
    assert.deepEqual(payload.capture, runtime.fullCapture);
    assert.equal(payload.nodes[0]?.label, "source");
  });
});

test("authoring persists iOS pixel, semantic, and closing-bracket times independently", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    runtime.observe = async () => ({
      capturedAt: 30,
      targetId: "device-a",
      fingerprint: "primary-raster",
      bounds: { width: 400, height: 800 },
      nodes: [{ role: "button", label: "Settings" }],
      proof: {
        schemaVersion: 1 as const,
        captureOrder: "pixels-ax-pixels" as const,
        pixels: {
          status: "captured" as const,
          capturedAt: 10,
          fingerprint: "primary-raster",
          bracket: {
            status: "changed" as const,
            afterCapturedAt: 30,
            afterFingerprint: "closing-raster",
          },
        },
        semantics: { status: "stale" as const, capturedAt: 20, fingerprint: "late-tree" },
      },
      screenshotCapturedAt: 10,
      screenshot: { data: Buffer.from("opening-raster"), mime: "image/png" },
      bracketScreenshot: {
        data: Buffer.from("closing-raster"),
        mime: "image/png",
        capturedAt: 30,
      },
    });
    const appMap = await readAppMap("project-a", appMapId);
    assert.ok(appMap);
    const session = await store.create({
      appMapId,
      target: { kind: "device", platform: "ios", targetId: "ipad-a" },
      leaseId: "lease-a",
      expectedAppMapRevision: appMap.revision,
    });

    const captured = await store.capture(session.id, runtime);
    const revision = captured.take!.revisions[0]!;
    const snapshot = revision.evidence.find((evidence) => evidence.kind === "snapshot");
    const screenshots = revision.evidence.filter((evidence) => evidence.kind === "screenshot");
    assert.equal(snapshot?.capturedAt, 20);
    assert.deepEqual(
      screenshots.map((evidence) => evidence.capturedAt),
      [10, 30],
    );
    assert.equal(revision.before?.capturedAt, 30);
    assert.equal(revision.before?.screen.capturedAt, 10);
    assert.equal(revision.before?.proof?.semantics.status, "stale");
    assert.ok(snapshot?.sha256);
    const payload = JSON.parse((await readAuthoringEvidence(snapshot.sha256))!.toString("utf8"));
    assert.equal(payload.capturedAt, 20);
    assert.equal(payload.observationCapturedAt, 30);
    assert.equal(payload.proof.pixels.bracket.afterCapturedAt, 30);
  });
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
    const raw = (await store.get(session.id)).take?.rawEvents ?? [];
    assert.deepEqual(
      raw.map((event) => event.kind),
      ["take-start", "interaction-intent", "interaction-outcome"],
    );
    const outcome = raw.at(-1);
    assert.ok(outcome && outcome.kind === "interaction-outcome");
    assert.equal(outcome.outcome, "failed");
  });
});

test("recording persists a redacted raw intent before native input and appends its linked outcome", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    let durableKinds: string[] | undefined;
    runtime.execute = async (activeSession) => {
      const durable = await store.get((activeSession as { id: string }).id);
      durableKinds = durable.take?.rawEvents?.map((event) => event.kind);
      runtime.screen = "destination";
    };

    session = await store.interact(
      session.id,
      {
        kind: "type",
        text: "private entry\n秘密",
        target: { label: "Private selector", identifier: "private-id" },
      },
      runtime,
    );

    assert.deepEqual(durableKinds, ["take-start", "interaction-intent"]);
    const raw = session.take?.rawEvents ?? [];
    assert.deepEqual(
      raw.map((event) => event.kind),
      ["take-start", "interaction-intent", "interaction-outcome"],
    );
    const intent = raw[1];
    const outcome = raw[2];
    assert.ok(intent && intent.kind === "interaction-intent");
    assert.ok(outcome && outcome.kind === "interaction-outcome");
    assert.equal(outcome.intentEventId, intent.id);
    assert.equal(outcome.outcome, "succeeded");
    assert.equal(outcome.links.actionId, session.take?.revisions.at(-1)?.actions[0]?.id);
    assert.equal(summarizeAuthoringSession(session).take?.rawCapture?.pendingIntentCount, 0);
    assert.doesNotMatch(JSON.stringify(raw), /private entry|秘密|Private selector|private-id/u);
  });
});

test("recording marks an intent unknown when native input returns but exit evidence fails", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    const observe = runtime.observe.bind(runtime);
    let failExitObservation = false;
    runtime.execute = async () => {
      runtime.screen = "destination";
      failExitObservation = true;
    };
    runtime.observe = async () => {
      if (failExitObservation) throw new Error("private native diagnostic");
      return observe();
    };

    await assert.rejects(
      store.interact(session.id, { kind: "tap", target: { label: "Private target" } }, runtime),
      /private native diagnostic/,
    );

    const raw = (await store.get(session.id)).take?.rawEvents ?? [];
    assert.deepEqual(
      raw.map((event) => event.kind),
      ["take-start", "interaction-intent", "interaction-outcome"],
    );
    const outcome = raw.at(-1);
    assert.ok(outcome && outcome.kind === "interaction-outcome");
    assert.equal(outcome.outcome, "unknown");
    assert.doesNotMatch(JSON.stringify(raw), /Private target|private native diagnostic/u);
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
    assert.ok(
      revision.actions.every(
        (action) =>
          action.entranceObservationId &&
          action.exitObservationId &&
          action.proofStatus === "verified",
      ),
    );
    const retainedIds = new Set(revision.observations?.map((observation) => observation.id));
    assert.ok(
      revision.actions.every(
        (action) =>
          action.entranceObservationId !== undefined &&
          action.exitObservationId !== undefined &&
          retainedIds.has(action.entranceObservationId) &&
          retainedIds.has(action.exitObservationId),
      ),
      "recorded action links must resolve from the bounded revision observation index",
    );
  });
});

test("recording rejects an action before input when its endpoint cannot be retained", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    const revision = session.take!.revisions.at(-1)!;
    const initial = revision.before!;
    const saturated = structuredClone(session);
    saturated.take!.revisions.at(-1)!.observations = Array.from(
      { length: MAX_AUTHORING_RETAINED_OBSERVATIONS },
      (_, index) =>
        index === 0
          ? initial
          : {
              ...structuredClone(initial),
              id: `retained-${index}`,
              screen: { ...initial.screen, id: `retained-${index}` },
            },
    );
    await writeFile(
      join(process.env.RELAY_STATE_DIR!, "authoring-sessions", `${session.id}.json`),
      JSON.stringify(saturated),
    );

    const executedBefore = runtime.executed.length;
    const observedBefore = runtime.observations;
    await assert.rejects(
      store.interact(session.id, { kind: "tap", target: { label: "Continue" } }, runtime),
      /stop and trim it before recording another action/,
    );
    assert.equal(runtime.executed.length, executedBefore);
    assert.equal(runtime.observations, observedBefore);
    assert.equal((await store.get(session.id)).take?.revisions.at(-1)?.actions.length, 0);
  });
});

test("per-action replay rejects an oversized editable Take before device observation", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.stop(session.id, runtime);
    const revision = session.take!.revisions.at(-1)!;
    const baseAction = revision.actions[0]!;
    const oversized = structuredClone(session);
    oversized.take!.revisions.at(-1)!.actions = Array.from(
      { length: MAX_AUTHORING_RETAINED_OBSERVATIONS },
      (_, index) => ({ ...structuredClone(baseAction), id: `oversized-${index}` }),
    );
    await writeFile(
      join(process.env.RELAY_STATE_DIR!, "authoring-sessions", `${session.id}.json`),
      JSON.stringify(oversized),
    );

    runtime.replayAction = async (_session, action) => {
      runtime.replayedActions.push(action.id);
      throw new Error("must not run");
    };
    runtime.observeReplayActionEndpoint = () => runtime.immediateReplayEndpoint();
    const observedBefore = runtime.observations;
    await assert.rejects(
      store.replay(session.id, runtime),
      /replay action endpoints; trim it before replaying/,
    );
    assert.equal(runtime.observations, observedBefore);
    assert.equal(runtime.replayedActions.length, 0);
  });
});

test("operator idle gaps are not replayed while explicit waits stay editable", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 230));
    session = await store.interact(session.id, { kind: "wait", ms: 600 }, runtime);
    session = await store.stop(session.id, runtime);

    const revision = session.take!.revisions.at(-1)!;
    const pauses = revision.actions.filter((action) => action.label === "Recorded pause");
    assert.equal(pauses.length, 0);
    const explicitWait = revision.actions.find((action) =>
      action.steps.some((step) => step.kind === "sleep" && step.ms === 600),
    );
    assert.ok(explicitWait);
    assert.deepEqual(explicitWait?.steps, [
      { id: `${explicitWait?.id}-step-1`, group: "Settings", kind: "sleep", ms: 600 },
    ]);

    runtime.screen = "source";
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");
    assert.ok(runtime.replayed.at(-1)?.some((step) => step.kind === "sleep" && step.ms === 600));
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
    assert.ok(
      session.take!.revisions.at(-1)!.actions.every((action) => action.proofStatus === undefined),
    );
    session = await store.replace(session.id, reversed[0]!, {
      kind: "steps",
      label: "Automatic",
      applied: true,
      steps: [{ kind: "sleep", ms: 10 }],
    });
    assert.equal(session.take!.revisions.at(-1)?.actions[0]?.label, "Automatic");
    assert.ok(
      session.take!.revisions.at(-1)!.actions.every((action) => action.proofStatus === undefined),
    );
    session = await store.trim(session.id, { actionIds: reversed.slice(0, 3), fromMs: 0 });
    assert.equal(session.take!.revisions.length, originalRevisions + 3);
    assert.equal(session.take!.revisions[originalRevisions - 1]?.actions.length, 4);
    assert.equal(session.take!.revisions.at(-1)?.actions.length, 3);
    assert.ok(
      session.take!.revisions.at(-1)!.actions.every((action) => action.proofStatus === undefined),
    );

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
    const finalOnlyReplay = session.take!.replayAttempts.at(-1)!;
    assert.equal(finalOnlyReplay.captureMode, "final-only");
    assert.ok(
      Object.values(finalOnlyReplay.actionProofs ?? {}).every(
        (proof) => proof.outcome === "unobserved" && proof.proofStatus === "unresolved",
      ),
      "legacy fake runtimes remain final-only rather than claiming per-action endpoints",
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
    assert.deepEqual(connection.recordingSource?.capture, {
      schemaVersion: 1,
      provenance: {
        schemaVersion: 1,
        mode: "control-and-record",
        origin: "relay-control",
      },
      proof: "replay-proved",
    });
    assert.equal(appMap.activity[session.id]?.eventType, "recording.committed");
  });
});

test("one canonical recording edit command safely composes semantic review changes", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      {
        kind: "steps",
        label: "Open settings",
        steps: [
          { kind: "tap", target: { label: "Menu" } },
          { kind: "tap", target: { label: "Settings" } },
        ],
      },
      runtime,
    );
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Data controls" } },
      runtime,
    );
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.stop(session.id, runtime);

    const original = session.take!.revisions.at(-1)!;
    const [navigation, destination, wait] = original.actions;
    assert.ok(navigation && destination && wait);

    session = await store.edit(session.id, {
      kind: "rename",
      actionId: navigation.id,
      intent: "Open Settings",
    });
    assert.equal(session.take!.revisions.at(-1)!.actions[0]!.label, "Open Settings");

    session = await store.edit(session.id, {
      kind: "split",
      actionId: navigation.id,
      atStep: 1,
    });
    let actions = session.take!.revisions.at(-1)!.actions;
    assert.equal(actions.length, 4);
    assert.deepEqual(
      actions.slice(0, 2).map((action) => action.steps.length),
      [1, 1],
    );

    session = await store.edit(session.id, {
      kind: "merge",
      actionIds: actions.slice(0, 2).map((action) => action.id),
      intent: "Open Settings",
    });
    actions = session.take!.revisions.at(-1)!.actions;
    assert.equal(actions.length, 3);
    assert.equal(actions[0]!.steps.length, 2);
    assert.equal(actions[0]!.label, "Open Settings");

    session = await store.edit(session.id, {
      kind: "replace",
      actionId: destination.id,
      interaction: { kind: "tap", target: { label: "Privacy controls" } },
    });
    actions = session.take!.revisions.at(-1)!.actions;
    assert.equal(actions.find((action) => action.id === destination.id)?.steps[0]?.kind, "tap");

    const reversed = actions.map((action) => action.id).reverse();
    session = await store.edit(session.id, { kind: "reorder", actionIds: reversed });
    assert.deepEqual(
      session.take!.revisions.at(-1)!.actions.map((action) => action.id),
      reversed,
    );

    session = await store.edit(session.id, { kind: "remove", actionIds: [wait.id] });
    const edited = session.take!.revisions.at(-1)!;
    assert.equal(edited.actions.length, 2);
    assert.ok(edited.actions.every((action) => action.proofStatus === undefined));
    assert.ok(edited.actions.every((action) => !action.entranceObservationId));
    assert.equal(edited.reason, "edit");
    assert.equal(
      session.take!.replayAttempts.some((attempt) => attempt.takeRevision === edited.revision),
      false,
    );

    await assert.rejects(
      store.edit(session.id, {
        kind: "merge",
        actionIds: [...edited.actions].reverse().map((action) => action.id),
      }),
      /consecutive actions in their current order/u,
    );
    await assert.rejects(
      store.edit(session.id, {
        kind: "split",
        actionId: edited.actions[0]!.id,
        atStep: edited.actions[0]!.steps.length,
      }),
      /between two existing steps/u,
    );
  });
});

test("edited multi-action replays retain an immediate proof for every action", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.interact(
      session.id,
      { kind: "screenshot", label: "Before submit" },
      runtime,
    );
    session = await store.interact(session.id, { kind: "observe", label: "Ready" }, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);

    const recorded = session.take!.revisions.at(-1)!;
    const byLabel = new Map(recorded.actions.map((action) => [action.label ?? action.id, action]));
    const tap = recorded.actions.find((action) => action.steps.some((step) => step.kind === "tap"));
    const beforeSubmit = byLabel.get("Before submit");
    const ready = byLabel.get("Ready");
    const initialWait = recorded.actions.find(
      (action) => action !== tap && action !== beforeSubmit && action !== ready,
    );
    assert.ok(tap && beforeSubmit && ready && initialWait);

    // The edit order keeps the navigation last, while trimming away the
    // screenshot creates a genuinely new multi-action path to prove.
    session = await store.reorder(session.id, [ready.id, beforeSubmit.id, initialWait.id, tap.id]);
    session = await store.trim(session.id, { actionIds: [ready.id, initialWait.id, tap.id] });
    const edited = session.take!.revisions.at(-1)!;
    assert.deepEqual(
      edited.actions.map((action) => action.id),
      [ready.id, initialWait.id, tap.id],
    );
    assert.ok(edited.actions.every((action) => action.proofStatus === undefined));

    runtime.replayAction = async (_session, action) => {
      runtime.replayedActions.push(action.id);
      if (action.steps.some((step) => step.kind === "tap")) runtime.screen = "destination";
    };
    runtime.observeReplayActionEndpoint = () => runtime.immediateReplayEndpoint();
    runtime.replayEndpointSemantics = "current";
    runtime.screen = "source";
    const fullObservationsBeforeReplay = runtime.observations;
    session = await store.replay(session.id, runtime);

    const semanticReplay = session.take!.replayAttempts.at(-1)!;
    assert.equal(semanticReplay.outcome, "passed");
    assert.equal(semanticReplay.captureMode, "per-action");
    assert.deepEqual(
      runtime.replayedActions,
      edited.actions.map((action) => action.id),
    );
    assert.equal(runtime.replayed.length, 0, "the legacy all-steps batch was not used");
    assert.equal(
      runtime.observations - fullObservationsBeforeReplay,
      2,
      "per-action endpoint capture does not call the slow full observer",
    );
    assert.equal(runtime.replayEndpointCaptures, edited.actions.length);
    const semanticResolver = new Set(
      semanticReplay.observations?.map((observation) => observation.id),
    );
    for (const action of edited.actions) {
      const proof = semanticReplay.actionProofs?.[action.id];
      assert.equal(proof?.outcome, "passed");
      assert.equal(proof?.proofStatus, "verified");
      const entranceId = proof?.entranceObservationId;
      const exitId = proof?.exitObservationId;
      assert.ok(entranceId);
      assert.ok(exitId);
      assert.ok(semanticResolver.has(entranceId));
      assert.ok(semanticResolver.has(exitId));
      assert.ok(
        proof?.evidenceIds.every((id) => semanticReplay.evidence.some((item) => item.id === id)),
      );
    }
    assert.equal(semanticReplay.actionProofs?.[ready.id]?.transition, "unchanged");
    assert.equal(semanticReplay.actionProofs?.[initialWait.id]?.transition, "unchanged");
    assert.equal(semanticReplay.actionProofs?.[tap.id]?.transition, "changed");

    // A real iOS fast endpoint is normally pixels-only. It still retains
    // both endpoints, but cannot silently create a semantic navigation edge.
    runtime.replayEndpointSemantics = "stale";
    runtime.screen = "source";
    session = await store.replay(session.id, runtime);
    const pixelsOnlyReplay = session.take!.replayAttempts.at(-1)!;
    assert.equal(pixelsOnlyReplay.outcome, "passed");
    for (const action of edited.actions) {
      const proof = pixelsOnlyReplay.actionProofs?.[action.id];
      assert.equal(proof?.outcome, "passed");
      assert.equal(proof?.proofStatus, "pixels-only");
      assert.equal(proof?.transition, "unproven");
    }
  });
});

test("a failed replay action stops the batch and marks later actions not-run", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    const [failedAction, skippedAction] = session.take!.revisions.at(-1)!.actions;
    assert.ok(failedAction && skippedAction);

    runtime.screen = "source";
    runtime.replayAction = async (_session, action) => {
      runtime.replayedActions.push(action.id);
      if (action.id === failedAction.id) throw new Error("intentional first action failure");
      runtime.screen = "destination";
    };
    runtime.observeReplayActionEndpoint = () => runtime.immediateReplayEndpoint();
    session = await store.replay(session.id, runtime);

    const replay = session.take!.replayAttempts.at(-1)!;
    assert.equal(replay.outcome, "failed");
    assert.deepEqual(runtime.replayedActions, [failedAction.id]);
    assert.equal(
      runtime.replayEndpointCaptures,
      0,
      "the failed action has no invented exit capture",
    );
    assert.equal(replay.actionProofs?.[failedAction.id]?.outcome, "failed");
    assert.equal(replay.actionProofs?.[failedAction.id]?.proofStatus, "unresolved");
    assert.equal(replay.actionProofs?.[skippedAction.id]?.outcome, "not-run");
    assert.equal(replay.actionProofs?.[skippedAction.id]?.exitObservationId, undefined);
  });
});

test("a replay source mismatch marks every action not-run before any action batch begins", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    const actions = session.take!.revisions.at(-1)!.actions;

    runtime.screen = "wrong-screen";
    runtime.replayAction = async (_session, action) => {
      runtime.replayedActions.push(action.id);
    };
    runtime.observeReplayActionEndpoint = () => runtime.immediateReplayEndpoint();
    session = await store.replay(session.id, runtime);

    const replay = session.take!.replayAttempts.at(-1)!;
    assert.equal(replay.outcome, "failed");
    assert.equal(replay.captureMode, "per-action");
    assert.deepEqual(runtime.replayedActions, []);
    assert.equal(runtime.replayEndpointCaptures, 0);
    for (const action of actions) {
      const proof = replay.actionProofs?.[action.id];
      assert.equal(proof?.outcome, "not-run");
      assert.equal(proof?.proofStatus, "unresolved");
      assert.equal(proof?.transition, "unproven");
      assert.equal(proof?.entranceObservationId, undefined);
      assert.equal(proof?.exitObservationId, undefined);
    }
  });
});

test("replay prepares a deterministic source before capturing or executing evidence", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);

    runtime.screen = "destination";
    runtime.prepareReplaySource = async () => {
      runtime.lifecycle.push("prepare-replay-source");
      runtime.screen = "source";
    };
    runtime.replayAction = async (_session, action) => {
      runtime.lifecycle.push(`replay:${action.id}`);
      runtime.replayedActions.push(action.id);
      runtime.screen = "destination";
    };
    runtime.observeReplayActionEndpoint = () => runtime.immediateReplayEndpoint();
    runtime.lifecycle = [];

    session = await store.replay(session.id, runtime);

    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");
    assert.equal(runtime.lifecycle[0], "prepare-replay-source");
    assert.equal(runtime.lifecycle[1], "observe");
    assert.ok(runtime.lifecycle[2]?.startsWith("replay:"));
  });
});

test("a replay source preparation failure is durable and executes no actions", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);

    runtime.prepareReplaySource = async () => {
      throw new Error("start URL is offline");
    };
    runtime.replayAction = async (_session, action) => {
      runtime.replayedActions.push(action.id);
    };
    runtime.observeReplayActionEndpoint = () => runtime.immediateReplayEndpoint();

    session = await store.replay(session.id, runtime);

    const replay = session.take!.replayAttempts.at(-1)!;
    assert.equal(replay.outcome, "failed");
    assert.match(replay.error ?? "", /return to the recorded starting screen.*offline/u);
    assert.deepEqual(runtime.replayedActions, []);
    for (const proof of Object.values(replay.actionProofs ?? {})) {
      assert.equal(proof.outcome, "not-run");
    }
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

test("a stale replay tree cannot validate a changed dynamic destination", async () => {
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
    runtime.fullObservationSemantics = "current";
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "tap", target: { label: "Send" } }, runtime);
    session = await store.stop(session.id, runtime);

    runtime.fullObservationSemantics = "stale";
    runtime.screen = "source";
    runtime.replayScreen = "replayed-destination";
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

test("saving an edited multi-screen replay retains its intermediate screen and raw selectors", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    runtime.fullObservationSemantics = "current";
    runtime.nodesByScreen.set("source", [{ role: "button", label: "Sign in" }]);
    runtime.nodesByScreen.set("middle", [{ role: "button", label: "Settings" }]);
    runtime.execute = async () => {
      runtime.screen = runtime.screen === "source" ? "middle" : "destination";
    };
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    for (const label of ["Sign in", "Settings"]) {
      session = await store.interact(session.id, { kind: "tap", target: { label } }, runtime);
    }
    session = await store.stop(session.id, runtime);
    const actionIds = session.take!.revisions.at(-1)!.actions.map((action) => action.id);
    session = await store.reorder(session.id, actionIds);
    assert.ok(session.take!.revisions.at(-1)!.actions.every((action) => !action.exitObservationId));
    runtime.prepareReplaySource = async () => {
      runtime.screen = "source";
    };
    runtime.replayAction = async () => {
      runtime.screen = runtime.screen === "source" ? "middle" : "destination";
    };
    runtime.observeReplayActionEndpoint = () => runtime.observe();
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)!.outcome, "passed");
    session = await store.commit(session.id, {
      createTest: true,
      testName: "Sign in and open Settings",
    });
    const map = (await readAppMap("project-a", appMapId))!;
    const connections = Object.values(map.connections);
    assert.equal(connections.length, 2);
    const first = connections.find(
      (connection) =>
        connection.actions[0]?.kind === "recorded" &&
        connection.actions[0].steps[0]?.kind === "tap" &&
        connection.actions[0].steps[0].target?.label === "Sign in",
    )!;
    assert.equal(first.destination.kind, "screen");
    if (first.destination.kind !== "screen") assert.fail("Expected an intermediate screen");
    const middle = map.screens[first.destination.screenId]!;
    assert.equal(middle.identity?.fingerprint, createHash("sha256").update("middle").digest("hex"));
    assert.ok(middle.variantIds.some((id) => map.screenVariants[id]?.rawAccessibilityTree));
    assert.ok(
      connections.some(
        (connection) =>
          connection.fromScreenId === middle.id &&
          connection.actions[0]?.kind === "recorded" &&
          connection.actions[0].steps[0]?.kind === "tap" &&
          connection.actions[0].steps[0].target?.label === "Settings",
      ),
    );
  });
});

test("an unedited live demonstration can be committed without a second pass", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    const before = await readAppMap("project-a", appMapId);
    assert.ok(before);
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
      createTest: true,
    });
    assert.equal(session.state, "committed");
    const appMap = await readAppMap("project-a", appMapId);
    assert.equal(appMap?.revision, before.revision + 1);
    const connection = appMap?.connections[session.committedConnectionId!];
    assert.equal(connection?.state, "ready");
    assert.equal(connection?.actions[0]?.kind, "recorded");
    const created = appMap?.tests[session.committedTestId!];
    assert.equal(created?.kind, "scenario");
    assert.equal(created?.name, "Settings localization");
    assert.notEqual(created?.name, connection?.label);
    const createdStep = created?.kind === "scenario" ? created.steps[0] : undefined;
    assert.deepEqual(
      createdStep?.kind === "instruction" &&
        createdStep.binding.status === "resolved" &&
        createdStep.binding.kind === "connections"
        ? createdStep.binding.connectionIds
        : undefined,
      [session.committedConnectionId],
    );
  });
});

test("recorded Test approval rolls back both artifacts when the atomic map write fails", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "key", key: "back" }, runtime);
    session = await store.stop(session.id, runtime);
    const before = await readAppMap("project-a", appMapId);
    assert.ok(before);

    await assert.rejects(
      store.commit(session.id, { createTest: true }, (boundary) => {
        if (boundary === "before-persist") throw new Error("simulated atomic write failure");
      }),
      /simulated atomic write failure/u,
    );

    const after = await readAppMap("project-a", appMapId);
    assert.deepEqual(after?.connections, before.connections);
    assert.deepEqual(after?.tests, before.tests);
    const restored = await store.get(session.id);
    assert.equal(restored.state, "reviewing");
    assert.equal(restored.committedConnectionId, undefined);
    assert.equal(restored.committedTestId, undefined);
  });
});

test("recorded Test approval leaves no partial artifacts after an App Map revision conflict", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "key", key: "back" }, runtime);
    session = await store.stop(session.id, runtime);

    const changed = await mutateStoredAppMap("project-a", appMapId, (current) => {
      const at = Date.now();
      return commitAppMapChanges(
        current,
        [
          {
            kind: "screen.add",
            input: {
              screen: {
                organizationId: current.organizationId,
                projectId: current.projectId,
                appMapId: current.id,
                id: "concurrent-screen",
                title: "Concurrent screen",
                variantIds: [],
                createdAt: at,
                updatedAt: at,
              },
            },
          },
        ],
        undefined,
        {
          expectedRevision: current.revision,
          eventId: "concurrent-map-change",
          actorId: "human:other",
          actorKind: "human",
          at,
        },
      );
    });

    await assert.rejects(
      store.commit(session.id, { createTest: true }),
      /App Map changed while this Take was being reviewed/u,
    );
    const after = await readAppMap("project-a", appMapId);
    assert.equal(after?.revision, changed.revision);
    assert.equal(Object.keys(after?.connections ?? {}).length, 0);
    assert.equal(Object.keys(after?.tests ?? {}).length, 0);
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

test("observing reviewed work preserves its destination and requires fresh replay proof", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);
    const recorded = structuredClone(session.take!.revisions.at(-1)!);
    runtime.screen = "source";
    session = await store.observe(session.id, runtime);
    const observed = session.take!.revisions.at(-1)!;
    assert.deepEqual(observed.after, recorded.after);
    assert.deepEqual(observed.actions, recorded.actions);
    assert.ok(observed.evidence.length > recorded.evidence.length);
    assert.equal(session.take!.rawEvents?.at(-1)?.kind, "observation");
    assert.equal(
      session.take!.replayAttempts.some(
        (attempt) => attempt.takeRevision === observed.revision && attempt.outcome === "passed",
      ),
      false,
    );
    await assert.rejects(
      store.commit(session.id, { createTest: true }),
      /Replay the current Take successfully/,
    );
    runtime.replayScreen = "destination";
    session = await store.replay(session.id, runtime);
    assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");
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
    assert.equal(session.take!.revisions.at(-1)?.actions[0]?.proofStatus, undefined);
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

test("restoring a prior Take revision appends a proof-invalidated copy and preserves raw capture", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Continue" } },
      runtime,
    );
    session = await store.stop(session.id, runtime);

    const takeBeforeEdits = session.take!;
    const source = takeBeforeEdits.revisions.find((revision) => revision.revision === 3);
    assert.ok(source);
    const sourceSnapshot = structuredClone(source);
    const rawSnapshot = structuredClone(takeBeforeEdits.rawEvents);

    session = await store.edit(session.id, {
      kind: "rename",
      actionId: source.actions[0]!.id,
      intent: "Edited action",
    });
    assert.equal(session.take!.currentRevision, 4);
    assert.equal(session.take!.revisions.at(-1)?.actions[0]?.label, "Edited action");

    session = await store.edit(session.id, { kind: "restore", sourceRevision: 3 });
    const restored = session.take!.revisions.at(-1)!;
    assert.equal(restored.revision, 5);
    assert.equal(session.take!.currentRevision, 5);
    assert.deepEqual(restored.evidence, sourceSnapshot.evidence);
    assert.deepEqual(restored.observations, sourceSnapshot.observations);
    assert.deepEqual(restored.before, sourceSnapshot.before);
    assert.deepEqual(restored.after, sourceSnapshot.after);
    assert.deepEqual(restored.videoClip, sourceSnapshot.videoClip);
    const expectedAction = { ...sourceSnapshot.actions[0]! };
    delete expectedAction.entranceObservationId;
    delete expectedAction.exitObservationId;
    delete expectedAction.proofStatus;
    assert.deepEqual(restored.actions[0], expectedAction);
    assert.equal(restored.actions[0]?.label, sourceSnapshot.actions[0]?.label);
    assert.deepEqual(session.take!.rawEvents, rawSnapshot);
    assert.deepEqual(session.take!.revisions[2], sourceSnapshot);

    await assert.rejects(
      store.edit(session.id, { kind: "restore", sourceRevision: 0 }),
      /existing prior Take revision/u,
    );
    await assert.rejects(
      store.edit(session.id, { kind: "restore", sourceRevision: 5 }),
      /existing prior Take revision/u,
    );
    await assert.rejects(
      store.edit(session.id, { kind: "restore", sourceRevision: 6 }),
      /existing prior Take revision/u,
    );
    assert.equal((await store.get(session.id)).take!.currentRevision, 5);
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

test("recovery preserves a pending pre-dispatch intent without inventing an outcome", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    const entrance = session.take?.revisions.at(-1)?.before;
    assert.ok(entrance);
    const intent = appendAuthoringRawInteractionIntent(session.take!, {
      target: session.target,
      interaction: {
        kind: "type",
        text: "interrupted private value",
        target: { label: "interrupted private selector" },
      },
      startedAt: Date.now(),
      entrance,
    });
    assert.ok(intent);
    const { intentEventId, ...raw } = intent;
    await writeFile(
      join(process.env.RELAY_STATE_DIR!, "authoring-sessions", `${session.id}.json`),
      JSON.stringify({ ...session, take: { ...session.take!, ...raw } }),
    );

    const recovered = await new AuthoringSessionStore().recover({ async releaseLease() {} });
    const restored = recovered[0];
    assert.ok(restored);
    assert.equal(restored.state, "failed");
    assert.deepEqual(
      pendingAuthoringRawInteractionIntents(restored.take!)?.map((event) => event.id),
      [intentEventId],
    );
    assert.equal(summarizeAuthoringSession(restored).take?.rawCapture?.pendingIntentCount, 1);
    assert.doesNotMatch(
      JSON.stringify(restored.take?.rawEvents),
      /interrupted private value|interrupted private selector/u,
    );
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
      store.commit(session.id, { createTest: true }, (boundary) => {
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
    assert.ok(afterCommitRecovery[0]?.committedTestId);
    assert.equal(
      appMap.tests[afterCommitRecovery[0]!.committedTestId!]?.name,
      "Settings localization",
    );
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

test("raw Takes preserve append-only source facts across review edits", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    const captureOnly = await createReadySession(store, runtime, appMapId);
    assert.deepEqual(captureOnly.captureProvenance, {
      schemaVersion: 1,
      mode: "control-and-record",
      origin: "relay-control",
    });
    const captured = await store.capture(captureOnly.id, runtime);
    assert.equal(captured.take?.rawCaptureVersion, AUTHORING_RAW_CAPTURE_VERSION);
    assert.deepEqual(
      captured.take?.rawEvents?.map((event) => [event.sequence, event.kind]),
      [[1, "take-start"]],
    );
    assert.equal(captured.take?.rawEvents?.[0]?.kind, "take-start");
    assert.equal(
      captured.take?.rawEvents?.[0]?.kind === "take-start" && captured.take.rawEvents[0].trigger,
      "capture",
    );

    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      {
        kind: "type",
        text: "super-secret\n秘密",
        target: { label: "Private recipient", identifier: "recipient-input" },
      },
      runtime,
    );
    session = await store.interact(
      session.id,
      {
        kind: "clipboard",
        action: "write",
        text: "super-secret\n秘密",
        expect: "super-secret\n秘密",
        target: { label: "Private clipboard" },
      },
      runtime,
    );
    session = await store.stop(session.id, runtime);

    const recorded = session.take!;
    const raw = recorded.rawEvents!;
    assert.deepEqual(
      raw.map((event) => [event.sequence, event.kind]),
      [
        [1, "take-start"],
        [2, "interaction-intent"],
        [3, "interaction-outcome"],
        [4, "interaction-intent"],
        [5, "interaction-outcome"],
        [6, "take-stop"],
      ],
    );
    const rawIntents = raw.filter((event) => event.kind === "interaction-intent");
    const rawOutcomes = raw.filter((event) => event.kind === "interaction-outcome");
    assert.equal(rawIntents.length, 2);
    assert.equal(rawOutcomes.length, 2);
    assert.deepEqual(
      rawOutcomes.map((event) => event.links.actionId),
      recorded.revisions.at(-1)?.actions.map((action) => action.id),
    );
    assert.equal(rawIntents[0]?.links.entranceObservationId, recorded.revisions.at(-1)?.before?.id);
    assert.equal(
      rawIntents[1]?.links.entranceObservationId,
      rawOutcomes[0]?.links.exitObservationId,
    );
    const final = raw.at(-1);
    assert.ok(final && final.kind === "take-stop");
    assert.equal(final.observation.observationId, recorded.revisions.at(-1)?.after?.id);
    assert.ok(final.evidenceIds.length > 0);
    assert.doesNotMatch(
      JSON.stringify(raw),
      /super-secret|秘密|Private recipient|recipient-input|Private clipboard/u,
    );

    const immutableRaw = structuredClone(raw);
    const actionIds = recorded.revisions
      .at(-1)!
      .actions.map((action) => action.id)
      .reverse();
    session = await store.reorder(session.id, actionIds);
    session = await store.replace(session.id, actionIds[0]!, {
      kind: "type",
      text: "new-private-value",
      target: { label: "Different private selector" },
    });
    session = await store.trim(session.id, { actionIds });
    assert.deepEqual(session.take?.rawEvents, immutableRaw);
    assert.equal(session.take?.rawCaptureVersion, AUTHORING_RAW_CAPTURE_VERSION);
  });
});

test("insert-before creates an immutable unproved action without changing the App Map", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(
      session.id,
      { kind: "tap", target: { label: "Start" } },
      runtime,
    );
    session = await store.interact(session.id, { kind: "tap", target: { label: "Stop" } }, runtime);
    session = await store.stop(session.id, runtime);
    const before = structuredClone(session.take!.revisions.at(-1)!);
    const mapBefore = await readAppMap("project-a", appMapId);
    const stop = before.actions.at(-1)!;
    session = await store.edit(session.id, {
      kind: "insert-before",
      actionId: stop.id,
      interaction: {
        kind: "steps",
        label: "Wait for timer",
        steps: [
          { kind: "wait-for", id: stop.steps[0]!.id, target: { label: "Stop" }, timeoutMs: 10000 },
        ],
      },
    });
    const after = session.take!.revisions.at(-1)!;
    assert.equal(after.actions.length, before.actions.length + 1);
    assert.deepEqual(
      after.actions
        .filter((action) => before.actions.some((old) => old.id === action.id))
        .map((action) => action.id),
      before.actions.map((action) => action.id),
    );
    const inserted = after.actions.at(-2)!;
    assert.equal(after.actions.at(-1)!.id, stop.id);
    assert.equal(inserted.steps[0]?.kind, "wait-for");
    assert.notEqual(inserted.steps[0]?.id, stop.steps[0]?.id);
    assert.equal(inserted.source, "manual");
    assert.deepEqual(inserted.evidenceIds, []);
    assert.ok(
      after.actions.every((action) => !action.proofStatus && !action.entranceObservationId),
    );
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(
      session.take!.revisions.find((revision) => revision.revision === before.revision),
      before,
    );
    assert.deepEqual(await readAppMap("project-a", appMapId), mapBefore);
    await assert.rejects(
      store.edit(session.id, {
        kind: "insert-before",
        actionId: "unknown",
        interaction: { kind: "wait", ms: 5000 },
      }),
      /outside this Take/u,
    );
    await assert.rejects(
      store.edit(session.id, {
        kind: "insert-before",
        actionId: stop.id,
        interaction: { kind: "observe" },
      }),
      /replayable step/u,
    );
  });
});

test("stores each observation once on disk and reads the Take back unchanged", async () => {
  await withWorkspace(async ({ store, runtime, appMapId }) => {
    let session = await createReadySession(store, runtime, appMapId);
    session = await store.start(session.id, runtime);
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.interact(session.id, { kind: "wait", ms: 0 }, runtime);
    session = await store.stop(session.id, runtime);
    const file = JSON.parse(
      await readFile(
        join(process.env.RELAY_STATE_DIR!, "authoring-sessions", `${session.id}.json`),
        "utf8",
      ),
    ) as {
      observationPool?: Record<string, unknown>;
      take: { revisions: { observations?: unknown; observationRefs?: string[] }[] };
    };
    const refs = file.take.revisions.flatMap((revision) => revision.observationRefs ?? []);
    assert.ok(file.observationPool, "observations are pooled");
    assert.ok(file.take.revisions.every((revision) => revision.observations === undefined));
    // Revisions repeat earlier observations; the pool holds each one once.
    assert.ok(Object.keys(file.observationPool).length < refs.length);
    assert.deepEqual(await store.get(session.id), session);
  });
});
