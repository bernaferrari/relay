import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { TargetSupervisorStore, runWithTargetSupervisorStore } from "./target-supervisor-store.js";
import {
  invalidateTargetSemanticControl,
  recordTargetPixelCapture,
  recordTargetSemanticFlightSettled,
  recordTargetSemanticSnapshot,
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

test("a fresh Android traversal replaces stale foreground context even when nodes omit package ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-supervisor-android-context-"));
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"));
  const androidTarget = { id: "emulator-context", kind: "android" } as const;
  try {
    store.recordSemanticReceipt(androidTarget, {
      state: "current",
      foregroundApp: "com.android.systemui",
    });
    runWithTargetSupervisorStore(store, () => {
      recordTargetSemanticSnapshot(
        { serial: androidTarget.id, platform: "android" },
        {
          inspectable: true,
          foregroundApp: "com.google.android.apps.nexuslauncher",
          nodes: [
            {
              label: "Relay",
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
