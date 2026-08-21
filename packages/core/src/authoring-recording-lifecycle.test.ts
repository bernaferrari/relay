import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringEvidence, AuthoringObservation, AuthoringSession } from "@relay/protocol";
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
