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

test("a verified live demonstration allows saving without claiming replay proof", () => {
  const recorded = structuredClone(session);
  recorded.captureProvenance = {
    schemaVersion: 1,
    mode: "control-and-record",
    origin: "relay-control",
  };
  recorded.take!.replayAttempts.push({
    source: "recording",
    id: "recording-proof",
    takeId: "take-1",
    takeRevision: 1,
    startedAt: 1,
    finishedAt: 2,
    outcome: "passed",
    evidence: [],
  });
  const snapshot = snapshotFromAuthoringSession({ frozen, session: recorded });
  assert.equal(snapshot.review?.latestReplay?.source, "recording");
  assert.equal(snapshot.capture?.proof, "relay-controlled");
  assert.equal(snapshot.review?.actions[0]?.captureProof, "relay-controlled");
  assert.equal(snapshot.review?.replayRequired, false);
  assert.equal(snapshot.allowedNextActions.includes("approve"), true);
});

test("point interactions remain distinguishable in human recording review", () => {
  const withPoint = structuredClone(session);
  withPoint.take!.revisions[0]!.actions[0]!.steps = [
    { kind: "tap", target: { point: { x: 148.4, y: 92.6 } } },
  ];

  const snapshot = snapshotFromAuthoringSession({
    ref: "opaque" as WorkflowRef,
    frozen,
    session: withPoint,
  });

  assert.equal(snapshot.review?.actions[0]?.intent, "Tap at 148, 93");
});

test("review projects bounded action evidence and timeline metadata without payloads", () => {
  const detailed = structuredClone(session);
  const revision = detailed.take!.revisions[0]!;
  const action = revision.actions[0]!;
  action.startedAt = 100;
  action.finishedAt = 350;
  action.steps = [{ kind: "type", text: "typed-secret-value" }];
  action.evidenceIds = ["evidence-action"];
  action.entranceObservationId = "observation-before";
  action.exitObservationId = "observation-after";
  revision.videoClip = { startMs: 1_500, endMs: 1_850 };
  revision.evidence = [
    {
      id: "evidence-action",
      kind: "screenshot",
      capturedAt: 200,
      uri: "/private/typed-secret-value.png",
      bytes: 12,
    },
    {
      id: "evidence-entrance",
      kind: "snapshot",
      capturedAt: 90,
      uri: "/private/tree.json",
    },
  ];
  revision.observations = [
    {
      id: "observation-before",
      capturedAt: 80,
      screen: {
        id: "screen-before",
        fingerprint: "fp-before",
        capturedAt: 80,
        source: "recording",
      },
      evidenceIds: ["evidence-entrance"],
      nodes: [{ value: "typed-secret-value" }],
    },
    {
      id: "observation-after",
      capturedAt: 400,
      screen: { id: "screen-after", fingerprint: "fp-after", capturedAt: 400, source: "recording" },
      evidenceIds: ["evidence-action"],
    },
  ];

  const snapshot = snapshotFromAuthoringSession({ frozen, session: detailed });
  const review = snapshot.review!;
  const reviewedAction = review.actions[0]!;

  assert.equal(review.currentRevision, 1);
  assert.equal(review.revisionCount, 1);
  assert.deepEqual(review.videoClip, { startMs: 1_500, endMs: 1_850 });
  assert.equal(reviewedAction.kind, "type");
  assert.equal(reviewedAction.startedAt, 100);
  assert.equal(reviewedAction.finishedAt, 350);
  assert.equal(reviewedAction.durationMs, 250);
  assert.deepEqual(reviewedAction.evidenceIds, ["evidence-action", "evidence-entrance"]);
  assert.equal(reviewedAction.evidenceCount, 2);
  assert.deepEqual(reviewedAction.evidenceKinds, ["screenshot", "snapshot"]);
  assert.deepEqual(reviewedAction.evidence, [
    { id: "evidence-action", kind: "screenshot", capturedAt: 200, roles: ["action", "exit"] },
    { id: "evidence-entrance", kind: "snapshot", capturedAt: 90, roles: ["entrance"] },
  ]);
  assert.deepEqual(review.timeline, {
    startedAt: 80,
    finishedAt: 400,
    durationMs: 320,
    actionCount: 1,
    evidenceCount: 2,
    observationCount: 2,
  });
  assert.doesNotMatch(JSON.stringify(review), /typed-secret-value/u);
  assert.doesNotMatch(JSON.stringify(review), /nodes/u);
});
