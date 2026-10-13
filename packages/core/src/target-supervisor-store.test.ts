import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { TargetRuntimeReadiness } from "@relay/protocol";
import { TargetSupervisorStore, runWithTargetSupervisorStore } from "./target-supervisor-store.js";
import {
  invalidateTargetSemanticControl,
  recordTargetPixelCapture,
  recordTargetSemanticFlightSettled,
  recordTargetSemanticSnapshot,
  targetRuntimeReadiness,
  TARGET_RUNTIME_READINESS_TTL_MS,
} from "./target-runtime-readiness.js";

class FakeClock {
  constructor(private value = 1_000) {}
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

const target = { id: "ipad-store", kind: "ios" } as const;

function unprovenReadiness() {
  return {
    previewPixels: {
      mode: "pixels" as const,
      state: "unproven" as const,
      freshness: "unproven" as const,
      reason: "not-yet-proven" as const,
    },
    semanticControl: {
      mode: "accessibility" as const,
      state: "unproven" as const,
      freshness: "unproven" as const,
      reason: "not-yet-proven" as const,
    },
    evidenceCapture: {
      mode: "evidence" as const,
      state: "unproven" as const,
      freshness: "unproven" as const,
      reason: "not-yet-proven" as const,
    },
  };
}

function provenReadiness(pixelAt: number, semanticAt: number): TargetRuntimeReadiness {
  return {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: pixelAt, durationMs: 7 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "proven",
      freshness: "current",
      proof: { at: semanticAt, durationMs: 11, observedNodeCount: 4 },
    },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at: pixelAt, durationMs: 7 },
    },
  };
}

test("pixels-only recovery retains the original semantic proof without counting another traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-proof-"));
  const clock = new FakeClock();
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), { clock });
  const runtimeTarget = { serial: "ipad-proof-recovery", platform: "ios" as const };
  const supervised = { id: runtimeTarget.serial, kind: "ios" as const };
  try {
    runWithTargetSupervisorStore(store, () => {
      recordTargetSemanticSnapshot(runtimeTarget, {
        inspectable: true,
        at: 999,
        durationMs: 11,
        nodes: [{ label: "Settings", rect: { x: 1, y: 1, width: 20, height: 20 } }],
      });
    });
    const before = store.health(supervised);
    clock.advance(500);
    runWithTargetSupervisorStore(store, () => {
      recordTargetPixelCapture(runtimeTarget, { at: 1_499, durationMs: 7 });
    });
    const recovered = store.recordRecoveryReceipt(supervised, {
      channel: "pixels",
      outcome: "succeeded",
      reason: "A screenshot was captured without reading accessibility.",
      readiness: targetRuntimeReadiness(runtimeTarget, clock.now()),
    });
    assert.equal(recovered.semantics.lastCapturedAt, 999);
    assert.deepEqual(recovered.readiness.semanticControl.proof, {
      at: 999,
      durationMs: 11,
      observedNodeCount: 1,
    });
    assert.equal(recovered.counters.semanticTraversals, before.counters.semanticTraversals);
    assert.equal(recovered.pixels.lastCapturedAt, 1_499);
    assert.deepEqual(recovered.readiness.previewPixels.proof, { at: 1_499, durationMs: 7 });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("retained semantic proof cannot restore current liveness after restart; a newer proof can", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-retained-proof-"));
  const path = join(root, "supervisors.sqlite");
  const clock = new FakeClock();
  const first = new TargetSupervisorStore(path, { clock });
  first.health(target, provenReadiness(1_000, 1_000));
  first.close();
  clock.advance(500);

  const restarted = new TargetSupervisorStore(path, { clock });
  try {
    const retained = restarted.health(target, provenReadiness(1_499, 1_000));
    assert.equal(retained.semantics.state, "stale");
    assert.equal(retained.semantics.lastCapturedAt, 1_000);
    assert.equal(retained.readiness.semanticControl.freshness, "stale");
    assert.equal(retained.counters.semanticTraversals, 1);

    clock.advance(500);
    const fresh = restarted.health(target, provenReadiness(1_999, 1_998));
    assert.equal(fresh.semantics.state, "current");
    assert.equal(fresh.semantics.lastCapturedAt, 1_998);
    assert.deepEqual(fresh.readiness.semanticControl.proof, {
      at: 1_998,
      durationMs: 11,
      observedNodeCount: 4,
    });
    assert.equal(fresh.counters.semanticTraversals, 2);
  } finally {
    restarted.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a retained current readiness receipt cannot undo semantic invalidation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-invalidated-proof-"));
  const clock = new FakeClock();
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), { clock });
  try {
    store.health(target, provenReadiness(1_000, 1_000));
    clock.advance(500);
    store.invalidateSemantics(target, "Confirmed input invalidated the tree.");
    const retained = store.health(target, provenReadiness(1_499, 1_000));
    assert.equal(retained.semantics.state, "stale");
    assert.equal(retained.semantics.lastCapturedAt, 1_000);
    assert.equal(retained.counters.semanticTraversals, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("durable health does not advertise expired pixel or semantic proof as current", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-expired-proof-"));
  const clock = new FakeClock();
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), { clock });
  try {
    store.health(target, provenReadiness(1_000, 1_000));
    clock.advance(TARGET_RUNTIME_READINESS_TTL_MS + 1);
    const expired = store.health(target, unprovenReadiness());
    assert.equal(expired.pixels.state, "delayed");
    assert.equal(expired.readiness.previewPixels.freshness, "unproven");
    assert.equal(expired.semantics.state, "stale");
    assert.equal(expired.readiness.semanticControl.freshness, "stale");
    assert.equal(expired.semantics.lastCapturedAt, 1_000);
    assert.equal(expired.counters.semanticTraversals, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("retained semantic receipts cannot replace foreground context with an older tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-older-context-"));
  const clock = new FakeClock();
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), { clock });
  try {
    store.recordSemanticReceipt(target, { state: "current", at: 999, foregroundApp: "ai.grok" });
    store.recordSemanticReceipt(target, { state: "current", at: 998, foregroundApp: "old.app" });
    store.recordSemanticReceipt(target, {
      state: "current",
      at: 999,
      foregroundApp: "retained.app",
    });
    assert.equal(store.health(target).context.foregroundApp, "ai.grok");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("future and negative capture timestamps cannot prove liveness or fence out a genuine capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-invalid-time-"));
  const clock = new FakeClock();
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), { clock });
  try {
    store.health(target, provenReadiness(1_001, 1_001));
    assert.notEqual(store.health(target).overall, "ready");
    store.health(target, provenReadiness(-1, -1));
    assert.notEqual(store.health(target).overall, "ready");
    const genuine = store.health(target, provenReadiness(1_000, 1_000));
    assert.equal(genuine.overall, "ready");
    assert.equal(genuine.semantics.lastCapturedAt, 1_000);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime capture receipts update the server-owned durable actor", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-"));
  const clock = new FakeClock();
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), { clock });
  try {
    runWithTargetSupervisorStore(store, () => {
      recordTargetPixelCapture(
        { serial: target.id, platform: "ios" },
        { at: 1_000, durationMs: 7, visualFingerprint: "pixels-a" },
      );
      clock.advance(1);
      recordTargetSemanticSnapshot(
        { serial: target.id, platform: "ios" },
        {
          inspectable: true,
          at: 1_001,
          durationMs: 11,
          nodes: [
            {
              label: "Settings",
              bundleId: "com.example.app",
              enabled: true,
              visibleToUser: true,
              rect: { x: 1, y: 1, width: 20, height: 20 },
            },
          ],
        },
      );
    });
    const health = store.health(target);
    assert.equal(health.overall, "ready");
    assert.equal(health.context.foregroundApp, "com.example.app");
    assert.equal(health.context.screenFingerprint, "pixels-a");
    assert.equal(health.latency.pixels.averageMs, 7);
    assert.equal(health.latency.semantics.averageMs, 11);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an authoritative Android foreground replaces the first tree package in supervisor context", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-android-context-"));
  const clock = new FakeClock();
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), { clock });
  const androidTarget = { id: "emulator-context", kind: "android" } as const;
  try {
    store.recordSemanticReceipt(androidTarget, {
      state: "current",
      foregroundApp: "com.android.systemui",
    });
    clock.advance(1);
    runWithTargetSupervisorStore(store, () => {
      recordTargetSemanticSnapshot(
        { serial: androidTarget.id, platform: "android" },
        {
          inspectable: true,
          at: clock.now(),
          foregroundApp: "com.google.android.apps.nexuslauncher",
          nodes: [
            {
              label: "Relay",
              bundleId: "com.android.systemui",
              enabled: true,
              visibleToUser: true,
              rect: { x: 1, y: 1, width: 20, height: 20 },
            },
          ],
        },
      );
    });
    assert.equal(
      store.health(androidTarget).context.foregroundApp,
      "com.google.android.apps.nexuslauncher",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a new server store rehydrates checkpoints and downgrades old liveness", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-restart-"));
  const path = join(root, "supervisors.sqlite");
  const clock = new FakeClock();
  const first = new TargetSupervisorStore(path, { clock });
  first.recordPixelCapture(target, { durationMs: 5, fingerprint: "before-restart" });
  first.recordSemanticReceipt(target, { state: "current", durationMs: 8 });
  assert.equal(first.health(target).overall, "ready");
  first.close();
  clock.advance(500);

  const restarted = new TargetSupervisorStore(path, { clock });
  try {
    const health = restarted.health(target, unprovenReadiness());
    assert.equal(health.epochs.target, 2);
    assert.equal(health.pixels.state, "delayed");
    assert.equal(health.semantics.state, "stale");
    assert.equal(health.overall, "starting");
    assert.equal(health.readiness.previewPixels.state, "unproven");
    assert.equal(health.events[0]?.code, "TARGET_SUPERVISOR_REHYDRATED");
  } finally {
    restarted.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an uncertain mutation remains fenced across a store restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-uncertain-"));
  const path = join(root, "supervisors.sqlite");
  const clock = new FakeClock();
  const first = new TargetSupervisorStore(path, { clock });
  first.transition(target, {
    kind: "input.intent-persisted",
    mutationId: "tap-1",
    intent: "Tap Settings",
  });
  first.transition(target, { kind: "input.dispatched", mutationId: "tap-1" });
  first.transition(target, {
    kind: "input.outcome-unknown",
    mutationId: "tap-1",
    reason: "Acknowledgement lost",
  });
  first.close();

  const restarted = new TargetSupervisorStore(path, { clock });
  try {
    const health = restarted.health(target);
    assert.equal(health.input.state, "uncertain");
    assert.equal(health.input.pendingMutationId, "tap-1");
    assert.equal(health.overall, "recovering");
    assert.throws(
      () =>
        restarted.transition(target, {
          kind: "input.intent-persisted",
          mutationId: "tap-2",
          intent: "Retry",
        }),
      /pending or uncertain/u,
    );
  } finally {
    restarted.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a semantic flight that settles after input remains stale in the durable actor", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-stale-flight-"));
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"));
  const runtimeTarget = { serial: target.id, platform: "ios" as const };
  const nodes = [
    {
      label: "Settings",
      enabled: true,
      visibleToUser: true,
      rect: { x: 1, y: 1, width: 20, height: 20 },
    },
  ];
  try {
    runWithTargetSupervisorStore(store, () => {
      recordTargetSemanticSnapshot(runtimeTarget, { inspectable: true, nodes, at: 2_000 });
      invalidateTargetSemanticControl(runtimeTarget, "input-changed", 2_001);
      recordTargetSemanticFlightSettled(runtimeTarget, {
        nodes,
        at: 2_002,
        staleAfterInput: true,
      });
    });
    assert.equal(store.health(target).semantics.state, "stale");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
