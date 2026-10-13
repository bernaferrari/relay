import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { operationDefinition } from "@relay/protocol";
import { loadEvidenceCollectionPolicy } from "./evidence-policy.js";
import { startRunEvidence, stopRunEvidence } from "./run-evidence.js";
import { runWithTargetContext } from "./target-context.js";
import type { Device } from "./device.js";
import type { TestJob } from "./session.js";

test("new workspaces use lightweight evidence by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-lightweight-policy-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const policy = await loadEvidenceCollectionPolicy();
    assert.equal(policy.mode, "lightweight");
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await loadEvidenceCollectionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});

test("full mode records a campaign video using the frozen policy", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "relay-full-video-"));
  const target = { kind: "device", platform: "android", serial: "full-video-fixture" } as const;
  const calls: string[] = [];
  let videoPath = "";
  const job = {
    id: "full-video-fixture-run",
    action: "fixture",
    targetKind: "device",
    platform: "android",
    serial: target.serial,
    targetContext: target,
    runDir,
    status: "running",
    queuedAt: Date.now(),
    steps: [],
    frames: [],
    artifacts: [],
    recipeSnapshot: { steps: [{ kind: "screenshot", check: { id: "checkpoint" } }] },
    evidencePolicy: { schemaVersion: 1, sensitive: {}, mode: "full" },
  } as unknown as TestJob;
  const device = {
    capture: { snapshot: async () => ({ nodes: [] }) },
    observability: {},
    recording: {
      record: async (input: { action: string; path?: string }) => {
        calls.push(input.action);
        if (input.action === "start") {
          videoPath = input.path!;
          await mkdir(join(runDir, "video"), { recursive: true });
          return { started: true };
        }
        await writeFile(videoPath, "retained-video");
        return { stopped: true };
      },
    },
  } as unknown as Device;
  try {
    await runWithTargetContext(target, async () => {
      const handle = await startRunEvidence(job, device, () => undefined, undefined, {
        foregroundAppResolver: async () => undefined,
      });
      await stopRunEvidence(handle, job, device, () => undefined);
      assert.deepEqual(calls, ["start", "stop"]);
      assert.equal(handle.manifest.collectionPolicy?.mode, "full");
      assert.equal(handle.manifest.channels.video.status, "captured");
      assert.equal(handle.manifest.channels.video.bytes, 14);
      assert.ok(job.artifacts.some((artifact) => artifact.kind === "video"));
    });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("lightweight runs retain screenshots, trees, and timeline without invoking a recorder", async () => {
  const target = { kind: "device", platform: "android", serial: "lightweight-fixture" } as const;
  const capturedAt = Date.now();
  const frame = { path: "frames/001.png", capturedAt, bytes: 123, caption: "Fixture" };
  let recordings = 0;
  const job = {
    id: "lightweight-fixture-run",
    action: "fixture",
    targetKind: "device",
    platform: "android",
    serial: target.serial,
    targetContext: target,
    status: "running",
    queuedAt: capturedAt,
    steps: [
      {
        id: "step-1",
        frames: [frame],
        actions: [{ kind: "tap", label: "Fixture", at: capturedAt }],
      },
    ],
    frames: [frame],
    artifacts: [
      {
        kind: "ui-tree",
        capturedAt,
        data: { stepId: "step-1", phase: "after", nodes: [{ role: "button" }] },
      },
    ],
    evidencePolicy: { schemaVersion: 1, sensitive: {}, mode: "lightweight" },
  } as unknown as TestJob;
  const device = {
    capture: { snapshot: async () => ({ nodes: [] }) },
    observability: {},
    recording: {
      record: async () => {
        recordings += 1;
        return { started: false, warning: "fixture recorder" };
      },
    },
  } as unknown as Device;
  await runWithTargetContext(target, async () => {
    const handle = await startRunEvidence(job, device, () => undefined, undefined, {
      foregroundAppResolver: async () => undefined,
    });
    await stopRunEvidence(handle, job, device, () => undefined);
    assert.equal(recordings, 0);
    assert.equal(handle.manifest.channels.screenshot.status, "captured");
    assert.equal(handle.manifest.channels.screenshot.bytes, 123);
    assert.equal(handle.manifest.channels["ui-tree"].entries, 1);
    assert.ok(
      handle.manifest.events.some((event) => event.kind === "tap" && event.stepId === "step-1"),
    );
    assert.ok(
      handle.manifest.events.some((event) => event.kind === "frame" && event.stepId === "step-1"),
    );
    assert.ok(handle.manifest.events.some((event) => event.kind === "snapshot.after"));
    assert.equal(handle.manifest.channels.video.entries, 0);
  });
});

test("workspace evidence operations accept a recording mode and reject malformed requests", () => {
  const parser = operationDefinition("workspace.evidence.update").input;
  assert.deepEqual(parser.parse({ mode: "lightweight" }), { mode: "lightweight" });
  assert.deepEqual(parser.parse({ mode: "full" }), { mode: "full" });
  assert.throws(() => parser.parse({ mode: "unexpected" }));
  assert.throws(() => parser.parse({ mode: "full", channel: "audio", enabled: true }));
});
