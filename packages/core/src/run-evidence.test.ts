import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Device } from "./device.js";
import { startRunEvidence, stopRunEvidence } from "./run-evidence.js";
import type { TestJob } from "./session.js";

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
