import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode, SnapshotState } from "../lib/api-types";
import type { AuthoringSession } from "@relay/protocol";
import {
  buildTapTarget,
  projectTake,
  selectProjectedAuthoringSession,
  semanticTapNode,
} from "./recorder";

test("resource identifiers are not recorded as accessibility labels", () => {
  assert.deepEqual(
    buildTapTarget(
      { width: 100, height: 200 },
      { identifier: "com.example:id/random_42", ref: "@e9" },
      0.25,
      0.5,
    ),
    {
      ref: "@e9",
      point: {
        x: 25,
        y: 100,
        anchor: { horizontal: "left", vertical: "top" },
        referenceBounds: { width: 100, height: 200 },
      },
    },
  );
});

test("an unlabeled tapped child inherits the closest accessibility label", () => {
  const parent: SnapshotNode = {
    index: 0,
    label: "Account",
    ref: "@e1",
    rect: { x: 0, y: 0, width: 100, height: 50 },
  };
  const child: SnapshotNode = {
    index: 1,
    parentIndex: 0,
    identifier: "com.example:id/icon",
    ref: "@e2",
    rect: { x: 10, y: 10, width: 20, height: 20 },
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [parent, child],
    interactive: [child],
    bounds: { width: 100, height: 200 },
  };

  const semantic = semanticTapNode(snapshot, child);
  assert.equal(semantic, parent);
  assert.deepEqual(buildTapTarget(snapshot.bounds, semantic, 0.2, 0.1), {
    ref: "@e1",
    label: "Account",
    point: {
      x: 20,
      y: 20,
      anchor: { horizontal: "left", vertical: "top" },
      referenceBounds: { width: 100, height: 200 },
    },
  });
});

test("remote authoring activity is visible without replacing local Journey or Target focus", () => {
  const session = (
    id: string,
    actorId: string,
    targetId: string,
    updatedAt: number,
  ): AuthoringSession => ({
    schemaVersion: 1,
    id,
    organizationId: "local",
    projectId: "default",
    actorId,
    actorKind: actorId.startsWith("agent:") ? "agent" : "human",
    appMapId: "map-a",
    state: "recording",
    target: { kind: "device", platform: "android", targetId },
    leaseId: `lease-${id}`,
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt,
  });
  const selectedTarget = "device-a";
  const projected = selectProjectedAuthoringSession(
    [session("remote", "agent:indexer", "device-a", 3), session("other", "agent:b", "device-b", 4)],
    { appMapId: "map-a", targetId: selectedTarget, actorId: "human:me" },
  );
  assert.equal(projected?.id, "remote");
  assert.equal(selectedTarget, "device-a");
});

test("Take projection preserves canonical zero-step and grouped action boundaries", () => {
  const session: AuthoringSession = {
    schemaVersion: 1,
    id: "session-1",
    organizationId: "local",
    projectId: "default",
    actorId: "human:me",
    actorKind: "human",
    appMapId: "map-a",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId: "device-a" },
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 4,
    take: {
      id: "take-1",
      state: "reviewing",
      createdAt: 1,
      updatedAt: 4,
      currentRevision: 1,
      replayAttempts: [],
      revisions: [
        {
          id: "revision-1",
          takeId: "take-1",
          revision: 1,
          createdAt: 4,
          createdBy: "human:me",
          reason: "recording",
          evidence: [],
          actions: [
            {
              id: "observe-action",
              source: "manual",
              recordedAt: 1,
              startedAt: 1,
              finishedAt: 1,
              steps: [],
              evidenceIds: [],
              label: "Wait for redirect",
            },
            {
              id: "grouped-action",
              source: "manual",
              recordedAt: 2,
              startedAt: 2,
              finishedAt: 3,
              steps: [
                { kind: "tap", target: { label: "Continue" } },
                { kind: "sleep", ms: 250 },
              ],
              evidenceIds: [],
            },
          ],
        },
      ],
    },
  };

  const take = projectTake(session, (uri) => uri);
  assert.ok(take);
  assert.equal(take.actions.length, 2);
  assert.deepEqual(
    take.actions.map((action) => ({
      id: action.id,
      start: action.stepStartIndex,
      steps: action.steps.length,
    })),
    [
      { id: "observe-action", start: 0, steps: 0 },
      { id: "grouped-action", start: 0, steps: 2 },
    ],
  );
  assert.deepEqual(take.actionIds, ["grouped-action", "grouped-action"]);
  assert.equal(take.steps.length, 2);
});

test("Take projection keeps recorded pauses visible and editable", () => {
  const session: AuthoringSession = {
    schemaVersion: 1,
    id: "session-timing",
    organizationId: "local",
    projectId: "default",
    actorId: "human:me",
    actorKind: "human",
    appMapId: "map-a",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId: "device-a" },
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 1_250,
    take: {
      id: "take-timing",
      state: "reviewing",
      createdAt: 1,
      updatedAt: 1_250,
      currentRevision: 1,
      replayAttempts: [],
      revisions: [
        {
          id: "revision-timing",
          takeId: "take-timing",
          revision: 1,
          createdAt: 1_250,
          createdBy: "human:me",
          reason: "recording",
          evidence: [],
          actions: [
            {
              id: "pause-action",
              source: "captured",
              label: "Recorded pause",
              recordedAt: 0,
              startedAt: 0,
              finishedAt: 1_250,
              steps: [{ kind: "sleep", ms: 1_250 }],
              evidenceIds: [],
            },
          ],
        },
      ],
    },
  };

  const take = projectTake(session, (uri) => uri);
  assert.equal(take?.actions[0]?.label, "Recorded pause");
  assert.deepEqual(take?.steps, [{ kind: "sleep", ms: 1_250 }]);
});
