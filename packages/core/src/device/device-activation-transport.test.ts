import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activationEvidenceHasPointContribution,
  activationTransportEvidence,
  activationTransportEvidenceSince,
  activationTransportSequence,
  activationTransportsSince,
  noteCoordinateActuation,
  noteDaemonSelectorActuation,
  noteDirectActuation,
  resetActivationTransportJournalsForTests,
} from "./device-activation-transport.js";
import { runWithTargetContext } from "../target/target-context.js";
import { resolveNamedControlOutcome } from "./device-target-resolution.js";
import { aggregateNativeResolutionMetrics } from "../evidence/native-resolution-metrics.js";
import type { SnapshotNode } from "./device-capabilities.js";

const iosContext = { kind: "device", platform: "ios", serial: "test-ios" } as const;
const androidContext = { kind: "device", platform: "android", serial: "test-android" } as const;

async function inContext<T>(
  context: typeof iosContext | typeof androidContext,
  operation: () => Promise<T>,
): Promise<T> {
  return runWithTargetContext(context, operation);
}

test("daemon selector actuation carries the point contribution only on ios", async () => {
  resetActivationTransportJournalsForTests();
  await inContext(iosContext, async () => {
    noteDaemonSelectorActuation({
      operation: "press",
      resolutionMethod: "label",
      snapshotPoint: { x: 10, y: 20 },
    });
    const evidence = activationTransportEvidence();
    assert.equal(evidence?.transport, "selector-point-assisted");
    assert.equal(evidence?.pointContribution, true);
    assert.equal(evidence?.coordinateFallbackPermitted, true);
  });
  await inContext(androidContext, async () => {
    noteDaemonSelectorActuation({
      operation: "press",
      resolutionMethod: "label",
      snapshotPoint: { x: 10, y: 20 },
    });
    const evidence = activationTransportEvidence();
    // Android payloads never carry the contribution even when one was resolved
    // locally — the same gate as iosNonHittablePressFields.
    assert.equal(evidence?.transport, "native-selector");
    assert.equal(evidence?.pointContribution, false);
    assert.equal(evidence?.coordinateFallbackPermitted, false);
  });
});

test("coordinate and direct actuations classify by provenance", async () => {
  resetActivationTransportJournalsForTests();
  await inContext(androidContext, async () => {
    const start = activationTransportSequence();
    noteCoordinateActuation({
      operation: "press",
      provenance: "snapshot-point",
      channel: "daemon",
      resolutionMethod: "identifier",
    });
    noteCoordinateActuation({ operation: "swipe", provenance: "explicit-point", channel: "adb" });
    noteDirectActuation("key", "daemon");
    const records = activationTransportsSince(start);
    assert.equal(records.length, 3);
    assert.equal(records[0]!.transport, "snapshot-point");
    assert.equal(records[0]!.resolutionMethod, "identifier");
    assert.equal(records[1]!.channel, "adb");
    assert.equal(records[2]!.transport, "direct");
    const evidence = activationTransportEvidenceSince(start);
    assert.equal(evidence?.actuations, 3);
    assert.equal(activationEvidenceHasPointContribution(evidence!), true);
  });
});

test("evidence dominance never launders geometry through a later direct actuation", async () => {
  resetActivationTransportJournalsForTests();
  await inContext(iosContext, async () => {
    noteCoordinateActuation({
      operation: "press",
      provenance: "snapshot-point",
      channel: "hid",
    });
    noteDirectActuation("type", "listener");
    const evidence = activationTransportEvidence();
    assert.equal(evidence?.transport, "snapshot-point");
    assert.equal(evidence?.channel, "hid");
    assert.equal(evidence?.actuations, 2);
  });
});

test("collision recovery evidence propagates", async () => {
  resetActivationTransportJournalsForTests();
  await inContext(iosContext, async () => {
    noteCoordinateActuation({
      operation: "press",
      provenance: "snapshot-point",
      channel: "listener",
      resolutionMethod: "label",
      collisionRecovery: true,
    });
    const evidence = activationTransportEvidence();
    assert.equal(evidence?.collisionRecovery, true);
  });
});

function node(
  partial: Partial<SnapshotNode> & {
    rect: { x: number; y: number; width: number; height: number };
  },
): SnapshotNode {
  return { ...partial } as SnapshotNode;
}

test("resolver surfaces selector failures on near-miss resolutions", () => {
  // Identifier absent, label ambiguous (two distinct locations), text unique:
  // the text resolution must carry both earlier failures.
  const nodes: SnapshotNode[] = [
    node({ label: "Save", rect: { x: 0, y: 0, width: 100, height: 40 }, hittable: true }),
    node({ label: "Save", rect: { x: 0, y: 200, width: 100, height: 40 }, hittable: true }),
    node({
      value: "unique text target",
      rect: { x: 0, y: 400, width: 100, height: 40 },
      hittable: true,
    }),
  ];
  const outcome = resolveNamedControlOutcome(nodes, {
    identifier: "missing-id",
    label: "Save",
    text: "unique text target",
  });
  assert.equal(outcome.status, "resolved");
  if (outcome.status !== "resolved") return;
  assert.equal(outcome.resolution.method, "text");
  const failures = outcome.resolution.selectorFailures ?? [];
  assert.ok(failures.length >= 1, "expected earlier selector failures to be preserved");
  assert.ok(
    failures.some((failure) => failure.method === "label" && failure.status === "ambiguous"),
    `expected the ambiguous label failure, got ${JSON.stringify(failures)}`,
  );
});

test("resolver attaches semantic failures to point resolutions", () => {
  const outcome = resolveNamedControlOutcome([], {
    label: "absent entirely",
    point: { x: 50, y: 60 },
  });
  assert.equal(outcome.status, "resolved");
  if (outcome.status !== "resolved") return;
  assert.equal(outcome.resolution.method, "point");
  assert.ok(
    (outcome.resolution.selectorFailures ?? []).some(
      (failure) => failure.method === "label" && failure.status === "absent",
    ),
    "point fallback must carry the semantic failures that pushed it onto geometry",
  );
});

test("clean first-method resolution has no selector failures", () => {
  const nodes: SnapshotNode[] = [
    node({
      identifier: "save-button",
      rect: { x: 0, y: 0, width: 100, height: 40 },
      hittable: true,
    }),
  ];
  const outcome = resolveNamedControlOutcome(nodes, { identifier: "save-button" });
  assert.equal(outcome.status, "resolved");
  if (outcome.status !== "resolved") return;
  assert.equal(outcome.resolution.selectorFailures, undefined);
});

test("native resolution metrics aggregate artifact evidence", () => {
  const metrics = aggregateNativeResolutionMetrics([
    {
      kind: "target-resolution",
      data: {
        method: "identifier",
        activationTransport: {
          transport: "native-selector",
          channel: "daemon",
          pointContribution: false,
          coordinateFallbackPermitted: true,
          actuations: 1,
        },
        treeQuality: {
          nodeCount: 40,
          namedNodeCount: 20,
          namedNodeRatio: 0.5,
          activatableNodeCount: 10,
          geometryNodeCount: 38,
        },
      },
    },
    {
      kind: "target-resolution",
      data: {
        method: "label",
        activationTransport: {
          transport: "snapshot-point",
          channel: "listener",
          pointContribution: true,
          coordinateFallbackPermitted: true,
          actuations: 1,
          collisionRecovery: true,
        },
        selectorFailures: [{ status: "ambiguous", method: "identifier", matches: 3, detail: "x" }],
        treeQuality: {
          nodeCount: 20,
          namedNodeCount: 5,
          namedNodeRatio: 0.25,
          activatableNodeCount: 4,
          geometryNodeCount: 20,
        },
      },
    },
    {
      kind: "target-resolution",
      data: { method: "point" },
    },
    { kind: "screenshot", data: {} },
  ]);
  assert.equal(metrics.resolutions, 3);
  assert.equal(metrics.byMethod.identifier, 1);
  assert.equal(metrics.byMethod.point, 1);
  assert.equal(metrics.byTransport["native-selector"], 1);
  assert.equal(metrics.byTransport["snapshot-point"], 1);
  assert.equal(metrics.byTransport.unobserved, 1);
  assert.equal(metrics.pointContributed, 1);
  assert.equal(metrics.coordinateFallbackPermitted, 2);
  assert.equal(metrics.nearMisses, 1);
  assert.equal(metrics.ambiguousNearMisses, 1);
  assert.equal(metrics.collisionRecoveries, 1);
  assert.equal(metrics.treeQuality.observed, 2);
  assert.equal(metrics.treeQuality.meanNodeCount, 30);
});
