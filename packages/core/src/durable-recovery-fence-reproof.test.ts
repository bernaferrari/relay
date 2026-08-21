import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { executionTargetRefKey, type LocalAgentDeviceExecutionTargetRef } from "@relay/protocol";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import {
  assertDurableRecoveryFenceReproofEligible,
  captureDurableRecoveryFenceReproof,
  DurableRecoveryFenceReproofError,
} from "./durable-recovery-fence-reproof.js";
import type { DurableWorkerAssignment } from "./durable-worker-assignments.js";
import type { ScreenshotPayload, SnapshotPayload } from "./workspace-capture.js";

function target(serial = "emulator-5554"): LocalAgentDeviceExecutionTargetRef {
  return {
    schemaVersion: 1,
    kind: "local-device",
    provider: { key: "relay.local.agent-device", scope: "local" },
    targetId: serial,
    platform: "android",
    identity: { kind: "device-serial", value: serial },
  };
}

function fencedAssignment(executionTarget = target()): DurableWorkerAssignment {
  return {
    schemaVersion: 1,
    id: "interrupted-job",
    projectId: "project-local",
    executionTarget,
    executionTargetKey: executionTargetRefKey(executionTarget),
    lane: { workerId: "local:android:emulator-5554", capacity: 1 },
    status: "recovery-required",
    queuedAt: 1,
    execution: { workerInstanceId: "before-restart", claimedAt: 2, heartbeatAt: 3 },
    terminal: {
      status: "recovery-required",
      at: 4,
      reason: "server-restart-during-execution",
    },
    updatedAt: 4,
  };
}

function screenPng(panelX = 12): Buffer {
  const png = new PNG({ width: 108, height: 234 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const panel = x >= panelX && x < panelX + 32 && y >= 22 && y < 40;
      png.data[offset] = panel ? 232 : 18;
      png.data[offset + 1] = panel ? 232 : 18;
      png.data[offset + 2] = panel ? 232 : 18;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function screenshot(serial: string, capturedAt: number, data = screenPng()): ScreenshotPayload {
  return {
    serial,
    capturedAt,
    mime: "image/png",
    base64: data.toString("base64"),
    path: `/tmp/${serial}-${capturedAt}.png`,
    bytes: data.byteLength,
    width: 108,
    height: 234,
  };
}

function readiness() {
  const proof = { at: 11, observedNodeCount: 1, durationMs: 5 };
  return {
    previewPixels: {
      mode: "pixels" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof,
    },
    semanticControl: {
      mode: "accessibility" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof,
    },
    evidenceCapture: {
      mode: "evidence" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof,
    },
  };
}

function snapshot(serial: string, capturedAt = 11): SnapshotPayload {
  const nodes = [{ role: "button", label: "Continue", visibleToUser: true }];
  return {
    serial,
    capturedAt,
    nodes,
    interactive: nodes,
    inspectable: true,
    source: "android-system",
    screenIdentity: {
      fingerprint: "a".repeat(64),
      nodes: [],
      volatileSignals: [],
    },
    readiness: readiness(),
  };
}

async function withStateRoot(operation: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-recovery-fence-reproof-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await operation(root);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("persists a fresh pixel-semantic-pixel bracket as a content-addressed durable reproof", async () => {
  await withStateRoot(async () => {
    const executionTarget = target();
    const cleaned: string[] = [];
    const reproof = await captureDurableRecoveryFenceReproof({
      assignment: fencedAssignment(executionTarget),
      executionTarget,
      capture: {
        captureScreenshot: (() => {
          let captures = 0;
          return async () => screenshot(executionTarget.targetId, captures++ === 0 ? 10 : 12);
        })(),
        captureSnapshot: async () => snapshot(executionTarget.targetId, 11),
        cleanupScreenshot: async (path) => {
          cleaned.push(path);
        },
      },
    });

    assert.match(reproof.id, /^durable-recovery-fence-reproof:[a-f0-9]{64}$/u);
    assert.equal(reproof.captureOrder, "pixels-ax-pixels");
    assert.equal(reproof.evidenceIds.length, 4);
    assert.deepEqual(cleaned, ["/tmp/emulator-5554-10.png", "/tmp/emulator-5554-12.png"]);
    const manifest = JSON.parse(
      (await readAuthoringEvidence(reproof.manifest.sha256!))!.toString("utf8"),
    ) as {
      assignmentId: string;
      executionTarget: { targetId: string };
      semantics: { evidence: { uri: string } };
    };
    assert.equal(manifest.assignmentId, "interrupted-job");
    assert.equal(manifest.executionTarget.targetId, executionTarget.targetId);
    assert.equal(manifest.semantics.evidence.uri, reproof.semantics.evidence.uri);
  });
});

test("keeps the fence eligible but unreleased when semantic evidence is not current", async () => {
  const executionTarget = target();
  const cleaned: string[] = [];
  let persisted = 0;
  await assert.rejects(
    captureDurableRecoveryFenceReproof({
      assignment: fencedAssignment(executionTarget),
      executionTarget,
      capture: {
        captureScreenshot: (() => {
          let captures = 0;
          return async () => screenshot(executionTarget.targetId, captures++ === 0 ? 10 : 12);
        })(),
        captureSnapshot: async () => ({
          ...snapshot(executionTarget.targetId, 11),
          inspectable: false,
          nodes: [],
          interactive: [],
          source: "pixels-only",
          readiness: {
            ...readiness(),
            semanticControl: {
              mode: "accessibility",
              state: "unavailable",
              freshness: "unproven",
              reason: "probe-failed",
            },
          },
        }),
        cleanupScreenshot: async (path) => {
          cleaned.push(path);
        },
        persistEvidence: async () => {
          persisted += 1;
          throw new Error("must not persist insufficient evidence");
        },
      },
    }),
    (error: unknown) =>
      error instanceof DurableRecoveryFenceReproofError &&
      error.code === "DURABLE_RECOVERY_FENCE_SEMANTIC_EVIDENCE_INVALID",
  );
  assert.equal(persisted, 0);
  assert.deepEqual(cleaned, ["/tmp/emulator-5554-10.png", "/tmp/emulator-5554-12.png"]);
});

test("rejects target mismatch before it can capture a reproof", () => {
  const assignment = fencedAssignment(target("emulator-5554"));
  assert.throws(
    () =>
      assertDurableRecoveryFenceReproofEligible({ assignment, executionTarget: target("other") }),
    (error: unknown) =>
      error instanceof DurableRecoveryFenceReproofError &&
      error.code === "DURABLE_RECOVERY_FENCE_TARGET_MISMATCH",
  );
});

test("rejects a changed pixel bracket rather than certifying a delayed semantic tree", async () => {
  const executionTarget = target();
  let persisted = 0;
  await assert.rejects(
    captureDurableRecoveryFenceReproof({
      assignment: fencedAssignment(executionTarget),
      executionTarget,
      capture: {
        captureScreenshot: (() => {
          let captures = 0;
          return async () =>
            screenshot(
              executionTarget.targetId,
              captures++ === 0 ? 10 : 12,
              captures === 1 ? screenPng(12) : screenPng(28),
            );
        })(),
        captureSnapshot: async () => snapshot(executionTarget.targetId, 11),
        cleanupScreenshot: async () => undefined,
        persistEvidence: async () => {
          persisted += 1;
          throw new Error("must not persist a changed bracket");
        },
      },
    }),
    (error: unknown) =>
      error instanceof DurableRecoveryFenceReproofError &&
      error.code === "DURABLE_RECOVERY_FENCE_EVIDENCE_CHANGED",
  );
  assert.equal(persisted, 0);
});
