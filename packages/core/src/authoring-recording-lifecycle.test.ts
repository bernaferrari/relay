import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringSession,
} from "@relay/protocol";
import { seedAuthoringRawRecording } from "./authoring-raw-recording.js";
import {
  finishAuthoringRecording,
  recordAuthoringInteraction,
  type AuthoringRecordingLifecycleDependencies,
  type PersistedAuthoringObservation,
} from "./authoring-recording-lifecycle.js";

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

  assert.deepEqual(order, ["write-session", "execute", "observe", "persist-observation"]);
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

  const session = await finishAuthoringRecording(
    recordingSession(),
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
    const executed: AuthoringInteraction[] = [];
    const writes: AuthoringSession[] = [];
    const lifecycle = dependencies({
      now: () => ++tick,
      async persistObservation() {
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
    assert.deepEqual(executed[1], {
      kind: "steps",
      label: "Wait for result · Copy message",
      steps: [
        {
          kind: "expect",
          target: { label: "Stop message" },
          condition: "gone",
          timeoutMs: 300_000,
        },
        { kind: "wait-for", target: { label: "Copy message" }, timeoutMs: 300_000 },
      ],
    });
    assert.equal(executed.length, 2);
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
