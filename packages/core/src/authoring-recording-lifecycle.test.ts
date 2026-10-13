import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringSession,
} from "@relay/protocol";
import {
  appendAuthoringRawInteractionIntent,
  seedAuthoringRawRecording,
} from "./authoring-raw-recording.js";
import {
  finishAuthoringRecording,
  recordAuthoringInteraction,
  type AuthoringRecordingLifecycleDependencies,
  type PersistedAuthoringObservation,
} from "./authoring-recording-lifecycle.js";
import {
  persistCapturedAuthoringObservation,
  type CapturedAuthoringObservation,
} from "./authoring-observation-capture.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import { nativeCaptureTargetProfile } from "./native-target-profile.js";
import { recordedActions } from "./app-map/recording-actions.js";
import { loadFrozenRecordedEntrances } from "./frozen-recorded-entrance.js";
import { authoringOriginApplication } from "./authoring-session-runtime.js";
import type { AppMapCompiledTest } from "@relay/protocol";

function evidence(id: string, capturedAt: number): AuthoringEvidence {
  return {
    id,
    kind: "screenshot",
    capturedAt,
    uri: `relay-evidence://${id}`,
  };
}

function observation(id: string, capturedAt: number): AuthoringObservation {
  return {
    id,
    capturedAt,
    screen: { id, fingerprint: id, capturedAt, source: "recording", deviceId: "ios-1" },
    evidenceIds: [`evidence-${id}`],
    proof: {
      schemaVersion: 1,
      captureOrder: "pixels-first",
      pixels: { status: "captured", capturedAt, fingerprint: id },
      semantics: { status: "unavailable", capturedAt },
    },
  };
}

function recordingSession(source = observation("source", 100)): AuthoringSession {
  const target = { kind: "device" as const, platform: "ios" as const, targetId: "ios-1" };
  return {
    schemaVersion: 1,
    id: "authoring-1",
    organizationId: "org-1",
    projectId: "project-1",
    actorId: "human-1",
    actorKind: "human",
    appMapId: "map-1",
    state: "recording",
    target,
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    createdAt: 100,
    updatedAt: 100,
    take: {
      id: "take-1",
      state: "recording",
      createdAt: 100,
      updatedAt: 100,
      currentRevision: 1,
      revisions: [
        {
          id: "take-1:revision:1",
          takeId: "take-1",
          revision: 1,
          createdAt: 100,
          createdBy: "human-1",
          reason: "recording",
          actions: [],
          evidence: [evidence("evidence-source", 100)],
          observations: [source],
          before: source,
          after: source,
        },
      ],
      replayAttempts: [],
      ...seedAuthoringRawRecording({
        target,
        trigger: "recording",
        recordedAt: 100,
        observation: source,
      }),
    },
  };
}

function dependencies(input: {
  now(): number;
  persistObservation(captured: string): Promise<PersistedAuthoringObservation>;
  persistEvidence: AuthoringRecordingLifecycleDependencies<string>["persistEvidence"];
  writeSession(session: AuthoringSession): Promise<void>;
}): AuthoringRecordingLifecycleDependencies<string> {
  return {
    ...input,
    nextRevision(session, reason, mutate) {
      const previous = session.take!.revisions.at(-1)!;
      const revision = mutate(structuredClone(previous));
      const createdAt = input.now();
      revision.id = `${session.take!.id}:revision:${previous.revision + 1}`;
      revision.revision = previous.revision + 1;
      revision.createdAt = createdAt;
      revision.createdBy = session.actorId;
      revision.reason = reason;
      return {
        ...session,
        updatedAt: createdAt,
        take: {
          ...session.take!,
          updatedAt: createdAt,
          currentRevision: revision.revision,
          revisions: [...session.take!.revisions, revision],
        },
      };
    },
  };
}

for (const originMode of ["requested", "observed"] as const) {
  test(`an iPad point with ${originMode} origin captures its exact selector entrance before the single dispatch`, async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-point-entrance-"));
    const previousState = process.env.RELAY_STATE_DIR;
    process.env.RELAY_STATE_DIR = root;
    let tick = 100;
    let dispatched = 0;
    const captures = new Map<string, CapturedAuthoringObservation>();
    const order: string[] = [];
    const app = "com.example.product";
    const source = observation("source", 100);
    source.nodes = [
      {
        type: "Application",
        depth: 0,
        bundleId: app,
        logicalCoordinates: true,
        rect: { x: 0, y: 0, width: 834, height: 1112 },
      },
    ];
    source.proof = {
      schemaVersion: 1,
      captureOrder: "pixels-ax-pixels",
      pixels: {
        status: "captured",
        capturedAt: 98,
        bracket: { status: "coherent", afterCapturedAt: 100 },
      },
      semantics: { status: "current", capturedAt: 99 },
    };
    const session = recordingSession(source);
    if (originMode === "requested") session.originApplication = app;
    const profile = nativeCaptureTargetProfile({
      targetId: session.target.targetId,
      platform: "ios",
      observedAt: tick,
      viewport: { width: 834, height: 1112 },
    });
    try {
      const recorded = await recordAuthoringInteraction(
        session,
        { kind: "tap", target: { point: { x: 25, y: 25 } } },
        {
          async observe(_session, request) {
            const at = (tick += 10);
            const key = `capture-${at}`;
            order.push(request?.includeIdentifiers?.[0] ?? "observe");
            captures.set(key, {
              capturedAt: at,
              targetId: session.target.targetId,
              fingerprint: "fixture-pixels",
              screenshotCapturedAt: at - 2,
              screenshot: { data: Buffer.from("fixture-raster"), mime: "image/png" },
              bounds: profile.viewport,
              nodes: [
                {
                  type: "Application",
                  depth: 0,
                  bundleId: app,
                  rect: { x: 0, y: 0, width: 834, height: 1112 },
                },
                {
                  type: "Button",
                  identifier: "sidebar.open.button",
                  label: "Open sidebar",
                  hittable: true,
                  rect: { x: 10, y: 10, width: 44, height: 44 },
                },
              ],
              proof: {
                schemaVersion: 1,
                captureOrder: "pixels-ax-pixels",
                pixels: {
                  status: "captured",
                  capturedAt: at - 2,
                  fingerprint: "fixture-pixels",
                  bracket: { status: "coherent", afterCapturedAt: at },
                },
                semantics: { status: "current", capturedAt: at - 1, fingerprint: "fixture-tree" },
              },
              capture: {
                snapshotSource: "sdk",
                inspectable: true,
                treeApp: app,
                ...(request
                  ? {
                      selectorEntrance: {
                        schemaVersion: 1,
                        request: {
                          identifiers: [...(request.includeIdentifiers ?? [])],
                          labels: [...(request.includeLabels ?? [])],
                        },
                        profile: {
                          id: profile.id,
                          targetId: profile.targetId,
                          platform: "ios",
                          viewport: profile.viewport!,
                          capabilities: ["snapshot", "screenshot"],
                        },
                      },
                    }
                  : {}),
              },
            });
            return key;
          },
          async execute(_session, executable) {
            dispatched++;
            order.push("dispatch");
            assert.deepEqual(executable, {
              kind: "tap",
              target: { identifier: "sidebar.open.button" },
            });
          },
        },
        dependencies({
          now: () => ++tick,
          persistObservation: (key) => persistCapturedAuthoringObservation(captures.get(key)!),
          async persistEvidence() {
            throw new Error("No video expected");
          },
          async writeSession() {},
        }),
      );
      const revision = recorded.take!.revisions.at(-1)!;
      const actions = recordedActions({
        sessionId: recorded.id,
        target: recorded.target,
        takeId: recorded.take!.id,
        takeRevision: revision.revision,
        entranceCaptureVersion: revision.entranceCaptureVersion,
        originApplication: authoringOriginApplication(recorded),
        observations: revision.observations,
        actions: revision.actions,
        evidenceIds: revision.evidence.map((item) => item.id),
        evidenceById: Object.fromEntries(revision.evidence.map((item) => [item.id, item])),
      });
      const action = actions[0]!;
      assert.equal(action.kind, "recorded");
      assert.ok(action.kind === "recorded");
      assert.equal(action.steps[0]!.recordedEntrance?.status, "captured");
      assert.deepEqual(order, ["observe", "sidebar.open.button", "dispatch", "observe"]);
      assert.equal(dispatched, 1);
      assert.equal(recorded.originApplication, originMode === "requested" ? app : undefined);
      const plan = {
        recipes: { flow: { id: "flow", steps: action.steps } },
      } as unknown as AppMapCompiledTest;
      const frozen = await loadFrozenRecordedEntrances(plan, readAuthoringEvidence);
      const entrances = Object.values(frozen!);
      assert.equal(entrances.length, 1);
      assert.equal(
        entrances[0]!.status,
        undefined,
        "the immutable raw tree must pass the offline identity guard",
      );
      assert.equal(entrances[0]!.sources[0]!.nodes?.length, 2);
    } finally {
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const changed of ["mismatched", "ambiguous"] as const) {
  test(`${changed === "ambiguous" ? "an" : "a"} ${changed} iPad selector entrance refuses the point before intent or dispatch`, async () => {
    let tick = 100;
    let captures = 0;
    let dispatches = 0;
    let writes = 0;
    const node = {
      type: "Button",
      identifier: "sidebar.open.button",
      label: "Open sidebar",
      hittable: true,
      rect: { x: 10, y: 10, width: 44, height: 44 },
    };
    const discovery = observation("discovery", 110);
    discovery.bounds = { width: 834, height: 1112 };
    discovery.proof!.semantics = {
      status: "current",
      capturedAt: 110,
      fingerprint: "fixture-tree",
    };
    discovery.nodes = [node];
    const selected = structuredClone(discovery);
    selected.id = "selected";
    selected.nodes =
      changed === "mismatched"
        ? [{ ...node, identifier: "another.button", label: "Another control" }]
        : [node, { ...node, rect: { x: 20, y: 20, width: 44, height: 44 } }];
    await assert.rejects(
      recordAuthoringInteraction(
        recordingSession(),
        { kind: "tap", target: { point: { x: 25, y: 25 } } },
        {
          async observe(_session, request) {
            if (++captures === 1) return "discovery";
            assert.deepEqual(request, { includeIdentifiers: ["sidebar.open.button"] });
            return "selected";
          },
          async execute() {
            dispatches++;
          },
        },
        dependencies({
          now: () => ++tick,
          async persistObservation(key) {
            return { observation: key === "discovery" ? discovery : selected, evidence: [] };
          },
          async persistEvidence() {
            throw new Error("No video expected");
          },
          async writeSession() {
            writes++;
          },
        }),
      ),
      /control changed before it could be recorded/i,
    );
    assert.equal(captures, 2);
    assert.equal(dispatches, 0);
    assert.equal(writes, 0);
  });
}

test("interaction lifecycle writes the raw intent before dispatch and links its terminal outcome", async () => {
  let tick = 100;
  const writes: string[][] = [];
  const order: string[] = [];
  const exit = observation("exit", 130);
  const lifecycle = dependencies({
    now: () => ++tick,
    async persistObservation(captured) {
      assert.equal(captured, "exit-capture");
      order.push("persist-observation");
      return { observation: exit, evidence: [evidence("evidence-exit", 130)] };
    },
    async persistEvidence() {
      throw new Error("interaction should not persist a video");
    },
    async writeSession(session) {
      writes.push(session.take?.rawEvents?.map((event) => event.kind) ?? []);
      order.push("write-session");
    },
  });
  const session = await recordAuthoringInteraction(
    recordingSession(),
    { kind: "tap", target: { label: "Private button" } },
    {
      async execute(current) {
        order.push("execute");
        assert.deepEqual(
          current.take?.rawEvents?.map((event) => event.kind),
          ["take-start", "interaction-intent"],
        );
      },
      async observe() {
        order.push("observe");
        return "exit-capture";
      },
    },
    lifecycle,
  );

  assert.deepEqual(order, [
    "observe",
    "persist-observation",
    "write-session",
    "execute",
    "observe",
    "persist-observation",
  ]);
  assert.deepEqual(writes, [["take-start", "interaction-intent"]]);
  assert.deepEqual(
    session.take?.rawEvents?.map((event) => event.kind),
    ["take-start", "interaction-intent", "interaction-outcome"],
  );
  const outcome = session.take?.rawEvents?.at(-1);
  assert.ok(outcome && outcome.kind === "interaction-outcome");
  assert.equal(outcome.outcome, "succeeded");
  assert.equal(outcome.links.actionId, session.take?.revisions.at(-1)?.actions[0]?.id);
  assert.doesNotMatch(JSON.stringify(session.take?.rawEvents), /Private button/u);
});

test("recording an iPad navigation region retains and executes the original Close point", async () => {
  let tick = 100;
  const entrance = observation("entrance", 110);
  entrance.bounds = { width: 1112, height: 834 };
  entrance.proof!.semantics = { status: "current", capturedAt: 110, fingerprint: "entrance" };
  entrance.nodes = [
    {
      index: 5,
      parentIndex: 4,
      identifier: "Settings",
      label: "Close",
      type: "NavigationBar",
      hittable: true,
      enabled: true,
      rect: { x: 204, y: 40, width: 704, height: 56 },
    },
  ];
  const target = { point: { anchored: true, x: 239, y: 67 } };
  const interaction: Extract<AuthoringInteraction, { kind: "tap" }> = {
    kind: "tap",
    target,
  };
  let captures = 0;
  const result = await recordAuthoringInteraction(
    recordingSession(),
    interaction,
    {
      async execute(_session, executable) {
        assert.deepEqual(executable, interaction);
      },
      async observe() {
        return ++captures === 1 ? "entrance" : "exit";
      },
    },
    dependencies({
      now: () => ++tick,
      async persistObservation(captured) {
        return {
          observation: captured === "entrance" ? entrance : observation("exit", 130),
          evidence: [],
        };
      },
      async persistEvidence() {
        throw new Error("no video");
      },
      async writeSession() {},
    }),
  );
  const step = result.take!.revisions.at(-1)!.actions[0]!.steps[0]!;
  assert.ok(step.kind === "tap");
  assert.deepEqual(step.target, target);
  const intent = result.take!.rawEvents!.find((event) => event.kind === "interaction-intent");
  assert.ok(intent && intent.kind === "interaction-intent");
  assert.ok(intent.interaction.kind === "tap");
  assert.deepEqual(intent.interaction.target, {
    point: { x: 239, y: 67 },
    strategies: ["point"],
  });
});

test("finish lifecycle seals video before endpoint capture and appends a raw stop", async () => {
  const order: string[] = [];
  const exit = observation("exit", 230);
  const ticks = [200, 201, 202];
  const lifecycle = dependencies({
    now: () => ticks.shift() ?? 202,
    async persistObservation(captured) {
      assert.equal(captured, "exit-capture");
      order.push("persist-observation");
      return { observation: exit, evidence: [evidence("evidence-exit", 230)] };
    },
    async persistEvidence(input) {
      order.push("persist-video");
      assert.equal(input.kind, "video");
      assert.equal(input.startMs, 0);
      assert.equal(input.endMs, 100);
      return { ...evidence("evidence-video", input.capturedAt), kind: "video" };
    },
    async writeSession() {
      throw new Error("finish should not write an interaction intent");
    },
  });

  const recording = recordingSession();
  recording.take!.revisions[0]!.actions.push({
    id: "tap",
    source: "manual",
    recordedAt: 100,
    startedAt: 100,
    finishedAt: 100,
    steps: [{ kind: "tap", target: { label: "Continue" } }],
    evidenceIds: [],
  });
  const session = await finishAuthoringRecording(
    recording,
    {
      async execute() {},
      async stopVideo() {
        order.push("stop-video");
        return { data: new Uint8Array([1]), mime: "video/mp4" };
      },
      async observe() {
        order.push("observe");
        return "exit-capture";
      },
    },
    lifecycle,
  );

  assert.deepEqual(order, ["stop-video", "observe", "persist-observation", "persist-video"]);
  assert.deepEqual(
    session.take?.rawEvents?.map((event) => event.kind),
    ["take-start", "take-stop"],
  );
  assert.deepEqual(session.take?.revisions.at(-1)?.videoClip, { startMs: 0, endMs: 100 });
});

test("zero actions with an unresolved native intent still require endpoint reconciliation", async () => {
  const session = recordingSession();
  const patch = appendAuthoringRawInteractionIntent(session.take!, {
    target: session.target,
    interaction: { kind: "tap", target: { label: "Continue" } },
    startedAt: 120,
    entrance: session.take!.revisions[0]!.before,
  });
  assert.ok(patch);
  const { intentEventId: _intentEventId, ...raw } = patch;
  Object.assign(session.take!, raw);
  const retained = structuredClone(session);
  let observations = 0;
  await assert.rejects(
    finishAuthoringRecording(
      session,
      {
        async execute() {
          throw new Error("Stop must not resend input");
        },
        async observe() {
          observations += 1;
          throw new Error("Device disconnected with input outcome unknown");
        },
      },
      dependencies({
        now: () => 130,
        async persistObservation() {
          throw new Error("no observation");
        },
        async persistEvidence() {
          throw new Error("no evidence");
        },
        async writeSession() {
          throw new Error("no new intent");
        },
      }),
    ),
    /input outcome unknown/,
  );
  assert.equal(observations, 1);
  assert.deepEqual(session, retained);
});

test("full-page capture retains document evidence without replacing viewport geometry", async () => {
  let tick = 100;
  const order: string[] = [];
  const result = await recordAuthoringInteraction(
    recordingSession(),
    { kind: "screenshot", fullPage: true },
    {
      async captureFullPage() {
        order.push("survey");
        return {
          evidence: [evidence("full-page", 120)],
          label: "Capture full page",
          fullPage: {
            status: "stopped",
            reason: "seam-ambiguous",
            message: "Review the retained frames.",
            frames: [{ index: 0, offsetY: 0, evidenceId: "full-page" }],
            diagnosticFrames: [{ index: 1, offsetY: 100, evidenceId: "diagnostic" }],
            mergedNodes: [{ label: "Continue", rect: { x: 1, y: 2, width: 3, height: 4 } }],
          },
        };
      },
      async execute() {
        throw new Error("must not replay survey gestures as user actions");
      },
      async observe() {
        order.push("viewport");
        return "restored";
      },
    },
    dependencies({
      now: () => ++tick,
      async persistObservation() {
        return {
          observation: observation("restored", 130),
          evidence: [evidence("evidence-restored", 130)],
        };
      },
      async persistEvidence() {
        throw new Error("unused");
      },
      async writeSession() {},
    }),
  );
  const revision = result.take!.revisions.at(-1)!;
  assert.deepEqual(order, ["survey", "viewport"]);
  assert.equal(revision.actions[0]?.label, "Capture full page");
  assert.ok(revision.actions[0]?.evidenceIds.includes("full-page"));
  assert.deepEqual(revision.actions[0]?.fullPage?.frames, [
    { index: 0, offsetY: 0, evidenceId: "full-page" },
  ]);
  assert.deepEqual(revision.actions[0]?.fullPage?.diagnosticFrames, [
    { index: 1, offsetY: 100, evidenceId: "diagnostic" },
  ]);
  assert.equal(revision.after?.id, "restored");
  assert.ok(!revision.after?.evidenceIds.includes("full-page"));
});

function generationObservation(
  id: string,
  capturedAt: number,
  busy: boolean,
): AuthoringObservation {
  const result = observation(id, capturedAt);
  result.foregroundApp = "test.app";
  result.proof!.semantics.status = "current";
  result.nodes = [
    { index: 1, label: "Explain why sailboats need a keel.", bundleId: "test.app" },
    {
      index: 2,
      label: busy ? "Stop message" : "Copy message",
      bundleId: "test.app",
      type: "android.widget.Button",
      hittable: true,
      rect: { x: 20, y: 200, width: 60, height: 60 },
    },
  ];
  return result;
}

for (const stop of [false, true]) {
  test(`completion is durably recorded before ${stop ? "Stop" : "the next capture"}`, async () => {
    let tick = 100;
    let frame = 0;
    let captures = 0;
    const executed: AuthoringInteraction[] = [];
    const writes: AuthoringSession[] = [];
    const lifecycle = dependencies({
      now: () => ++tick,
      async persistObservation() {
        if (captures++ === 0)
          return {
            observation: generationObservation("fresh-entrance", 199, false),
            evidence: [evidence("evidence-fresh-entrance", 199)],
          };
        const capturedAt = 200 + frame++;
        const captured = generationObservation(`frame-${frame}`, capturedAt, frame === 1);
        return {
          observation: captured,
          evidence: [evidence(`evidence-${captured.id}`, capturedAt)],
        };
      },
      async persistEvidence() {
        throw new Error("no video");
      },
      async writeSession(session) {
        writes.push(structuredClone(session));
      },
    });
    const runtime = {
      async execute(session: AuthoringSession, interaction: AuthoringInteraction) {
        assert.equal(session.take!.rawEvents!.at(-1)!.kind, "interaction-intent");
        executed.push(interaction);
      },
      async observe() {
        return "capture";
      },
    };
    let session = await recordAuthoringInteraction(
      recordingSession(generationObservation("initial", 100, false)),
      { kind: "tap", target: { identifier: "send" } },
      runtime,
      lifecycle,
    );
    session = stop
      ? await finishAuthoringRecording(session, runtime, lifecycle)
      : await recordAuthoringInteraction(
          session,
          { kind: "screenshot", label: "Finished response" },
          runtime,
          lifecycle,
        );
    const revision = session.take!.revisions.at(-1)!;
    assert.equal(revision.actions[1]!.label, "Wait for result · Copy message");
    const readiness = revision.actions[1]!;
    assert.equal(readiness.steps.length, 1);
    const step = readiness.steps[0]!;
    assert.equal(step.kind, "wait-response");
    assert.ok(step.kind === "wait-response");
    assert.equal(step.timeoutMs, 120_000);
    assert.deepEqual(step.target, { label: "Copy message" });
    assert.deepEqual(step.busyTarget, { label: "Stop message" });
    assert.deepEqual(step.idleTarget, { label: "Copy message" });
    assert.equal(readiness.entranceObservationId, "frame-1");
    assert.equal(readiness.exitObservationId, "frame-3");
    assert.ok(revision.observations?.some((item) => item.id === "frame-1"));
    assert.ok(revision.observations?.some((item) => item.id === "frame-3"));
    assert.equal(executed.length, 1, "observed completion is retained without a second execution");
    assert.equal(writes.length, stop ? 2 : 3);
    assert.ok(
      revision.actions.every((action) => action.steps.every((step) => step.kind !== "sleep")),
    );
    assert.equal(revision.after!.id, stop ? "frame-3" : "frame-4");
    if (stop) assert.equal(session.take!.rawEvents!.at(-1)!.kind, "take-stop");
  });
}

test("cancellation never infers completion or executes a wait", async () => {
  let tick = 100;
  const source = generationObservation("busy", 100, true);
  const session = recordingSession(source);
  session.take!.revisions[0]!.actions.push({
    id: "send",
    source: "manual",
    recordedAt: 100,
    startedAt: 100,
    finishedAt: 100,
    steps: [],
    evidenceIds: [],
  });
  const result = await finishAuthoringRecording(
    session,
    {
      async execute() {
        throw new Error("cancel must not wait");
      },
      async observe() {
        return "ready";
      },
    },
    dependencies({
      now: () => ++tick,
      async persistObservation() {
        return { observation: generationObservation("ready", 200, false), evidence: [] };
      },
      async persistEvidence() {
        throw new Error("no video");
      },
      async writeSession() {
        throw new Error("no inferred action");
      },
    }),
    { inferCompletion: false },
  );
  assert.equal(result.take!.revisions.at(-1)!.actions.length, 1);
});
