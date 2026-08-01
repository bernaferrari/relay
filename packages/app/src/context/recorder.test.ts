import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode, SnapshotState } from "../lib/api-types";
import type { AuthoringSession } from "@relay/protocol";
import { buildTapTarget, selectProjectedAuthoringSession, semanticTapNode } from "./recorder";

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
    journeyId: "journey-a",
    state: "recording",
    target: { kind: "device", platform: "android", targetId },
    leaseId: `lease-${id}`,
    expectedJourneyRevision: 1,
    expectedRecipeRevision: 1,
    createdAt: 1,
    updatedAt,
  });
  const selectedTarget = "device-a";
  const projected = selectProjectedAuthoringSession(
    [session("remote", "agent:indexer", "device-a", 3), session("other", "agent:b", "device-b", 4)],
    { journeyId: "journey-a", targetId: selectedTarget, actorId: "human:me" },
  );
  assert.equal(projected?.id, "remote");
  assert.equal(selectedTarget, "device-a");
});
