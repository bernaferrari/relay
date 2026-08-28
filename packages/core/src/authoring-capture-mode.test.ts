import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthoringCaptureProvenance,
  AuthoringObservation,
  AuthoringSession,
  AuthoringTakeRevision,
} from "@relay/protocol";
import {
  approvedAfterObservation,
  attachLiveDemonstrationAttempt,
} from "./authoring-session-screen-proof.js";

const before: AuthoringObservation = {
  id: "before",
  capturedAt: 10,
  screen: { id: "source", fingerprint: "source-fingerprint", capturedAt: 10, source: "recording" },
  evidenceIds: [],
};
const after: AuthoringObservation = {
  id: "after",
  capturedAt: 20,
  screen: {
    id: "destination",
    fingerprint: "destination-fingerprint",
    capturedAt: 20,
    source: "recording",
  },
  evidenceIds: [],
};

function reviewingSession(captureProvenance: AuthoringCaptureProvenance): AuthoringSession {
  const revision: AuthoringTakeRevision = {
    id: "revision-1",
    takeId: "take-1",
    revision: 1,
    createdAt: 10,
    createdBy: "agent:test",
    reason: "recording",
    actions: [],
    evidence: [],
    before,
    after,
  };
  return {
    schemaVersion: 1,
    id: "session-1",
    organizationId: "local",
    projectId: "project-1",
    actorId: "agent:test",
    actorKind: "agent",
    appMapId: "map-1",
    testName: "Observed path",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId: "device-1" },
    captureProvenance,
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    take: {
      id: "take-1",
      state: "reviewing",
      createdAt: 10,
      updatedAt: 20,
      currentRevision: 1,
      revisions: [revision],
      replayAttempts: [],
    },
    createdAt: 1,
    updatedAt: 20,
  };
}

test("watch-and-infer never turns screen observations into a synthetic passing replay", async () => {
  const session = reviewingSession({
    schemaVersion: 1,
    mode: "watch-and-infer",
    origin: "observed-transition",
  });
  const reviewed = await attachLiveDemonstrationAttempt(session);

  assert.equal(reviewed.take?.replayAttempts.length, 0);
  await assert.rejects(
    approvedAfterObservation(reviewed, reviewed.take!.revisions[0]!),
    /Replay the current Take successfully/u,
  );
});

test("instrumented provenance also waits for explicit replay in the offline first slice", async () => {
  const session = reviewingSession({
    schemaVersion: 1,
    mode: "instrumented",
    origin: "app-instrumentation",
  });
  const reviewed = await attachLiveDemonstrationAttempt(session);

  assert.equal(reviewed.take?.replayAttempts.length, 0);
  reviewed.take!.replayAttempts.push({
    id: "replay-1",
    takeId: "take-1",
    takeRevision: 1,
    startedAt: 30,
    finishedAt: 40,
    outcome: "passed",
    evidence: [],
    after,
  });
  assert.deepEqual(await approvedAfterObservation(reviewed, reviewed.take!.revisions[0]!), after);
});
