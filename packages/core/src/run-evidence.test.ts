import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Device } from "./device.js";
import {
  initializeRunEvidence,
  startRunEvidence as startRunEvidenceWithoutContext,
  stopRunEvidence as stopRunEvidenceWithoutContext,
  withTimeout,
} from "./run-evidence.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

const testTarget = { kind: "device", platform: "android", serial: "run-evidence-test" } as const;
const startRunEvidence: typeof startRunEvidenceWithoutContext = (...args) =>
  runWithTargetContext(testTarget, () => startRunEvidenceWithoutContext(...args));
const stopRunEvidence: typeof stopRunEvidenceWithoutContext = (...args) =>
  runWithTargetContext(testTarget, () => stopRunEvidenceWithoutContext(...args));

test("run evidence records video and performance without affecting the run", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const calls: string[] = [];
  const device = {
    observability: {
      perf: async () => {
        calls.push("perf");
        return { cpu: 12 };
      },
    },
    recording: {
      record: async (options: { action: "start" | "stop"; path?: string }) => {
        calls.push(options.action);
        if (options.action === "start" && options.path) {
          await mkdir(join(root, "seed"), { recursive: true });
        }
        if (options.action === "stop") {
          await mkdir(join(job.runDir!, "video"), { recursive: true });
          await writeFile(join(job.runDir!, "video", "run.mp4"), Buffer.from("video"));
        }
        return { ok: true };
      },
    },
  } as unknown as Device;
  const job = {
    id: "evidence-run",
    action: "chat-smoke",
    platform: "android",
    targetContext: testTarget,
    status: "running",
    queuedAt: Date.now(),
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Chat smoke",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;

  try {
    const handle = await startRunEvidence(job, device, () => undefined);
    await stopRunEvidence(handle, job, device, () => undefined);

    assert.deepEqual(calls, ["perf", "start", "perf", "stop"]);
    assert.ok(job.artifacts.some((item) => item.kind === "performance-start"));
    const video = job.artifacts.find((item) => item.kind === "video");
    assert.ok(video);
    assert.deepEqual((video.data as { files: unknown }).files, [
      { path: "video/run.mp4", bytes: 5 },
    ]);
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("run evidence capture failures remain warnings", async () => {
  const warnings: string[] = [];
  const device = {
    observability: { perf: async () => Promise.reject(new Error("metrics unavailable")) },
    recording: { record: async () => Promise.reject(new Error("recorder unavailable")) },
  } as unknown as Device;
  const job = {
    id: "evidence-warning",
    action: "chat-smoke",
    platform: "android",
    targetContext: testTarget,
    status: "running",
    queuedAt: Date.now(),
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Chat smoke",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;

  const handle = await startRunEvidence(job, device, (line) => warnings.push(line));
  await stopRunEvidence(handle, job, device, (line) => warnings.push(line));
  assert.ok(warnings.every((line) => line.startsWith("warn:")));
  assert.equal(job.status, "running");
});

test("run evidence keeps the run healthy when a recorder reports no encoder", async () => {
  const warnings: string[] = [];
  const device = {
    observability: { perf: async () => ({}) },
    recording: {
      record: async (options: { action: "start" | "stop" }) =>
        options.action === "start"
          ? { started: false, warning: "Video recording is unavailable" }
          : { stopped: true },
    },
  } as unknown as Device;
  const job = {
    id: "evidence-no-encoder",
    action: "chat-smoke",
    platform: "android",
    targetContext: testTarget,
    status: "running",
    queuedAt: Date.now(),
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Chat smoke",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;

  const handle = await startRunEvidence(job, device, (line) => warnings.push(line));
  await stopRunEvidence(handle, job, device, (line) => warnings.push(line));

  assert.ok(warnings.some((line) => line.includes("Video recording is unavailable")));
  assert.equal(
    job.artifacts.some((item) => item.kind === "video"),
    false,
  );
  assert.equal(job.status, "running");
});

test("physical iOS skips collectors that compete with its XCTest control session", async () => {
  const calls: string[] = [];
  const device = {
    observability: {
      perf: async () => {
        calls.push("perf");
        return {};
      },
      logs: async () => {
        calls.push("logs");
        return {};
      },
      network: async () => {
        calls.push("network");
        return {};
      },
    },
    recording: {
      record: async () => {
        calls.push("video");
        return {};
      },
    },
  } as unknown as Device;
  const target = { kind: "device", platform: "ios", serial: "physical-ipad" } as const;
  const job = {
    id: "physical-ios-evidence",
    action: "settings",
    platform: "ios",
    targetContext: target,
    status: "running",
    queuedAt: Date.now(),
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Settings",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;

  const handle = await runWithTargetContext(target, () =>
    startRunEvidenceWithoutContext(job, device, () => undefined, undefined, {
      physicalIos: true,
    }),
  );
  await runWithTargetContext(target, () =>
    stopRunEvidenceWithoutContext(handle, job, device, () => undefined),
  );

  assert.deepEqual(calls, []);
  for (const name of ["performance", "logs", "network", "video"] as const) {
    assert.equal(handle.manifest.channels[name].status, "unsupported");
  }
});

test("consent grants activate audio, crash, and network-body collectors", async () => {
  const networkIncludes: string[] = [];
  const device = {
    observability: {
      perf: async () => ({}),
      logs: async () => ({ entries: [] }),
      network: async (options: { include?: string }) => {
        networkIncludes.push(options.include ?? "summary");
        return { entries: [{ requestBody: "prompt", responseBody: "answer" }] };
      },
      audio: async (options: { probeAction?: string }) => ({
        entries: [{ bucketMs: 250, level: 0.4 }],
        action: options.probeAction,
      }),
      crashes: async (options: { action: string; since: number }) => ({
        platform: "android" as const,
        since: options.since,
        entries: options.action === "dump" ? [{ source: "logcat", message: "fatal" }] : [],
        truncated: false,
      }),
    },
    recording: { record: async () => ({ started: false, warning: "no encoder" }) },
  } as unknown as Device;
  const job = {
    id: "evidence-sensitive",
    action: "chat-smoke",
    platform: "android",
    targetContext: testTarget,
    status: "running",
    queuedAt: Date.now(),
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Sensitive evidence",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: {
      schemaVersion: 1,
      sensitive: Object.fromEntries(
        ["audio", "crash", "network-body"].map((channel) => [
          channel,
          { grantedAt: Date.now(), grantedBy: "tester", reason: "trial" },
        ]),
      ),
    },
  } as TestJob;

  const handle = await startRunEvidence(job, device, () => undefined);
  await stopRunEvidence(handle, job, device, () => undefined);

  assert.deepEqual(networkIncludes, ["all", "all"]);
  assert.ok(job.artifacts.some((artifact) => artifact.kind === "audio"));
  assert.ok(job.artifacts.some((artifact) => artifact.kind === "crash"));
  assert.equal(job.evidence?.channels.audio.status, "captured");
  assert.equal(job.evidence?.channels.crash.status, "captured");
  assert.equal(job.evidence?.collectionPolicy?.sensitive["network-body"]?.grantedBy, "tester");
});

test("timed-out collectors compensate when they start late", async () => {
  let resolveStart: ((value: { started: true }) => void) | undefined;
  const start = new Promise<{ started: true }>((resolve) => {
    resolveStart = resolve;
  });
  let cleaned = false;
  await assert.rejects(
    withTimeout(start, 5, "late collector", async () => {
      cleaned = true;
    }),
    /timed out/,
  );
  resolveStart?.({ started: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cleaned, true);
});

test("deferred evidence preserves source capture time and is chronologically resequenced", async () => {
  const job = {
    id: "evidence-source-time",
    action: "timeline",
    platform: "android",
    targetContext: testTarget,
    status: "running",
    queuedAt: Date.now(),
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Source chronology",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;
  const handle = initializeRunEvidence(job);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const frame = {
    path: "frames/001.png",
    caption: "captured",
    capturedAt: handle.startedAt + 8,
    bytes: 5,
  };
  job.frames.push(frame);
  job.steps.push({
    id: "step-1",
    index: 0,
    kind: "Replay",
    tone: "acc",
    title: "Tap",
    glyphs: ["tap"],
    actions: [{ kind: "tap", at: handle.startedAt + 12, label: "Continue" }],
    startedAt: handle.startedAt + 2,
    finishedAt: handle.startedAt + 14,
    frames: [frame],
    log: "",
  });
  job.artifacts.push(
    {
      kind: "ui-tree",
      capturedAt: handle.startedAt + 4,
      data: { stepId: "step-1", phase: "before", nodes: [{ id: "button" }] },
    },
    {
      kind: "command-attempt",
      capturedAt: handle.startedAt + 10,
      data: { stepId: "step-1", command: { action: "tap" } },
    },
  );

  await stopRunEvidence(handle, job, undefined, () => undefined);

  const events = job.evidence!.events;
  const tree = events.find((item) => item.kind === "snapshot.before")!;
  const frameEvent = events.find((item) => item.kind === "frame")!;
  const command = events.find((item) => item.kind === "command.attempt")!;
  const action = events.find((item) => item.kind === "tap")!;
  assert.deepEqual(
    [tree.at, frameEvent.at, command.at, action.at],
    [handle.startedAt + 4, handle.startedAt + 8, handle.startedAt + 10, handle.startedAt + 12],
  );
  assert.deepEqual(
    [tree.monotonicMs, frameEvent.monotonicMs, command.monotonicMs, action.monotonicMs],
    [4, 8, 10, 12],
  );
  assert.deepEqual(
    events.map((item) => item.sequence),
    events.map((_item, index) => index + 1),
  );
  assert.ok(
    events.every(
      (item, index) => index === 0 || events[index - 1]!.monotonicMs <= item.monotonicMs,
    ),
  );
});
