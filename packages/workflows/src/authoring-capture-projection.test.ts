import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSession } from "@relay/protocol";
import { snapshotFromAuthoringSession } from "./authoring-projection.js";
import type { FrozenAuthorTestIdentity, WorkflowRef } from "./types.js";

const session: AuthoringSession = {
  schemaVersion: 1,
  id: "session-watch",
  organizationId: "local",
  projectId: "project-1",
  actorId: "agent:test",
  actorKind: "agent",
  appMapId: "map-1",
  testName: "Observed settings",
  state: "reviewing",
  target: { kind: "device", platform: "android", targetId: "device-1" },
  captureProvenance: {
    schemaVersion: 1,
    mode: "watch-and-infer",
    origin: "observed-transition",
  },
  leaseId: "lease-1",
  expectedAppMapRevision: 1,
  take: {
    id: "take-1",
    state: "reviewing",
    createdAt: 1,
    updatedAt: 2,
    currentRevision: 1,
    revisions: [
      {
        id: "revision-1",
        takeId: "take-1",
        revision: 1,
        createdAt: 1,
        createdBy: "agent:test",
        reason: "recording",
        actions: [
          {
            id: "action-1",
            source: "captured",
            recordedAt: 1,
            startedAt: 1,
            finishedAt: 2,
            steps: [{ kind: "tap", target: { label: "Settings" } }],
            evidenceIds: [],
          },
        ],
        evidence: [],
      },
    ],
    replayAttempts: [],
  },
  createdAt: 1,
  updatedAt: 2,
};

const frozen: FrozenAuthorTestIdentity = {
  title: "Observed settings",
  actorId: "agent:test",
  appMapId: "map-1",
  appMapRevision: 1,
  target: session.target,
};

test("inferred recording projections are visibly unproved and cannot be approved", () => {
  const snapshot = snapshotFromAuthoringSession({
    ref: "opaque" as WorkflowRef,
    frozen,
    session,
  });

  assert.equal(snapshot.capture?.mode, "watch-and-infer");
  assert.equal(snapshot.capture?.proof, "inferred-unproved");
  assert.equal(snapshot.capture?.replayRequiredBeforeApproval, true);
  assert.equal(snapshot.review?.actions[0]?.captureProof, "inferred-unproved");
  assert.equal(snapshot.review?.replayRequired, true);
  assert.equal(snapshot.allowedNextActions.includes("approve"), false);
  assert.match(snapshot.problems[0]?.title ?? "", /not proved/u);
});

test("a passing replay upgrades inferred actions without rewriting their provenance", () => {
  const replayed = structuredClone(session);
  replayed.take!.replayAttempts.push({
    id: "replay-1",
    takeId: "take-1",
    takeRevision: 1,
    startedAt: 3,
    finishedAt: 4,
    outcome: "passed",
    evidence: [],
  });
  const snapshot = snapshotFromAuthoringSession({
    ref: "opaque" as WorkflowRef,
    frozen,
    session: replayed,
  });

  assert.equal(snapshot.capture?.mode, "watch-and-infer");
  assert.equal(snapshot.capture?.proof, "replay-proved");
  assert.equal(snapshot.review?.actions[0]?.captureProof, "replay-proved");
  assert.equal(snapshot.allowedNextActions.includes("approve"), true);
});
