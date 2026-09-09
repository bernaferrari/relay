import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Device } from "./device.js";
import {
  initializeRunEvidence,
  runEvidenceFinalizationDevice,
  startRunEvidence as startRunEvidenceWithoutContext,
  stopRunEvidence as stopRunEvidenceWithoutContext,
  withTimeout,
  withTimeoutAndDrain,
} from "./run-evidence.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

const testTarget = { kind: "device", platform: "android", serial: "run-evidence-test" } as const;
const previousSuiteRunsRoot = process.env.RELAY_RUNS_DIR;
const suiteRunsRoot = await mkdtemp(join(tmpdir(), "relay-evidence-suite-"));
process.env.RELAY_RUNS_DIR = suiteRunsRoot;
test.after(async () => {
  if (previousSuiteRunsRoot === undefined) delete process.env.RELAY_RUNS_DIR;
  else process.env.RELAY_RUNS_DIR = previousSuiteRunsRoot;
  await rm(suiteRunsRoot, { recursive: true, force: true });
});
const startRunEvidence: typeof startRunEvidenceWithoutContext = (...args) =>
  runWithTargetContext(testTarget, () => startRunEvidenceWithoutContext(...args));
const stopRunEvidence: typeof stopRunEvidenceWithoutContext = (...args) =>
  runWithTargetContext(testTarget, () => stopRunEvidenceWithoutContext(...args));

test("timed-out Android automation is drained before control returns", async () => {
  const events: string[] = [];
  let resolveLate: ((value: string) => void) | undefined;
  const late = new Promise<string>((resolve) => {
    resolveLate = resolve;
  });

  await assert.rejects(
    withTimeoutAndDrain(late, 1, "Android snapshot", () => {
      events.push("aborted");
      setImmediate(() => {
        events.push("settled");
        resolveLate?.("late");
      });
    }),
    /Android snapshot timed out/u,
  );
  events.push("returned");

  assert.deepEqual(events, ["aborted", "settled", "returned"]);
});

test("managed-emulator packet evidence brackets the Run and survives cancelled adapter teardown", async () => {
  const avdDirectory = await mkdtemp(join(tmpdir(), "relay-run-emulator-packets-"));
  const events: string[] = [];
  const emulatorTarget = {
    kind: "device",
    platform: "android",
    serial: "emulator-5560",
  } as const;
  const emptyPcap = Buffer.alloc(24);
  emptyPcap.writeUInt32LE(0xa1b2c3d4, 0);
  emptyPcap.writeUInt16LE(2, 4);
  emptyPcap.writeUInt16LE(4, 6);
  emptyPcap.writeUInt32LE(65_535, 16);
  emptyPcap.writeUInt32LE(1, 20);
  const job = {
    id: "emulator-packet-run",
    action: "proof",
    serial: emulatorTarget.serial,
    platform: "android",
    targetKind: "device",
    targetContext: emulatorTarget,
    targetProfile: {
      id: "device:emulator-5560",
      targetId: emulatorTarget.serial,
      source: "device",
      platform: "android",
      name: "Medium phone",
      observedAndroidAvdName: "medium_phone",
      viewport: { width: 1080, height: 2400 },
      capabilities: ["screenshot", "snapshot"],
      observedAt: 1,
    },
    status: "running",
    queuedAt: 1,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Emulator packet Run",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: {
      schemaVersion: 1,
      sensitive: {
        "network-raw": {
          grantedAt: 1,
          grantedBy: "human:test",
          reason: "Exercise consented cancellation finalization",
        },
      },
      redaction: { enabled: false, source: "workspace", locked: false },
    },
  } as unknown as TestJob;
  const device = {
    capture: {
      snapshot: async () => {
        events.push("prime");
        return { nodes: [] };
      },
    },
    observability: {
      perf: async () => ({}),
      logs: async () => ({}),
      network: async () => ({}),
    },
    recording: { record: async () => ({ started: false, warning: "not needed" }) },
  } as unknown as Device;

  try {
    const handle = await runWithTargetContext(emulatorTarget, () =>
      startRunEvidenceWithoutContext(job, device, () => undefined, undefined, {
        foregroundAppResolver: async () => undefined,
        androidPacketRuntime: {
          resolveAvdDirectory: async () => avdDirectory,
          readLocalAddresses: async () => ["10.0.2.15"],
          execAdb: async (args) => {
            if (args.includes("start")) {
              events.push("packet-start");
              await mkdir(join(avdDirectory, "console_out"), { recursive: true });
              await writeFile(join(avdDirectory, "console_out", args.at(-1)!), emptyPcap);
            } else {
              events.push("packet-stop");
            }
            return { stdout: "OK", stderr: "" };
          },
        },
      }),
    );
    await runWithTargetContext(emulatorTarget, () =>
      stopRunEvidenceWithoutContext(handle, job, undefined, () => undefined),
    );

    assert.equal(events[0], "packet-start");
    assert.ok(!events.includes("prime"), "packet evidence must not acquire UI automation");
    assert.equal(events.at(-1), "packet-stop");
    const artifact = job.artifacts.find((item) => item.kind === "network");
    assert.ok(artifact);
    assert.equal(
      (artifact.data as { androidNetwork?: { source?: { kind?: string } } }).androidNetwork?.source
        ?.kind,
      "emulator-packet",
    );
    assert.equal(handle.manifest.channels.network.status, "captured");
    assert.equal(
      (
        artifact.data as {
          androidNetwork?: {
            rawCapture?: { status?: string; retention?: string; artifact?: { path?: string } };
          };
        }
      ).androidNetwork?.rawCapture?.status,
      "captured",
    );
    assert.equal(
      (
        artifact.data as {
          androidNetwork?: { rawCapture?: { retention?: string } };
        }
      ).androidNetwork?.rawCapture?.retention,
      "retained",
    );
    assert.equal(
      (
        artifact.data as {
          androidNetwork?: { rawCapture?: { artifact?: { path?: string } } };
        }
      ).androidNetwork?.rawCapture?.artifact?.path,
      "network/capture.pcap",
    );
    assert.equal((await stat(join(job.runDir!, "network", "capture.pcap"))).mode & 0o777, 0o600);
  } finally {
    await rm(avdDirectory, { recursive: true, force: true });
  }
});

test("managed-emulator packet start failure remains partial when the session log succeeds", async () => {
  const emulatorTarget = {
    kind: "device",
    platform: "android",
    serial: "emulator-5562",
  } as const;
  const job = {
    id: "emulator-packet-start-failure",
    action: "proof",
    serial: emulatorTarget.serial,
    platform: "android",
    targetKind: "device",
    targetContext: emulatorTarget,
    targetProfile: {
      id: "device:emulator-5562",
      targetId: emulatorTarget.serial,
      source: "device",
      platform: "android",
      name: "Medium phone",
      androidAvdName: "missing_phone",
      viewport: { width: 1080, height: 2400 },
      capabilities: ["screenshot", "snapshot"],
      observedAt: 1,
    },
    status: "running",
    queuedAt: 1,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Emulator packet start failure",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: {
      schemaVersion: 1,
      sensitive: {},
      redaction: { enabled: false, source: "workspace", locked: false },
    },
  } as unknown as TestJob;
  const device = {
    apps: { open: async () => ({ appId: "com.example.app" }) },
    capture: { snapshot: async () => ({ nodes: [] }) },
    observability: {
      perf: async () => ({}),
      logs: async () => ({}),
      network: async (input: { action?: string }) =>
        input.action === "dump"
          ? {
              entries: [{ method: "GET", url: "https://example.test/health", status: 200 }],
            }
          : { started: true },
    },
    recording: { record: async () => ({ started: false, warning: "not needed" }) },
  } as unknown as Device;

  const handle = await runWithTargetContext(emulatorTarget, () =>
    startRunEvidenceWithoutContext(job, device, () => undefined, undefined, {
      foregroundAppResolver: async () => "com.example.app",
      androidPacketRuntime: {
        resolveAvdDirectory: async () => {
          throw new Error("managed AVD directory disappeared");
        },
      },
    }),
  );
  await runWithTargetContext(emulatorTarget, () =>
    stopRunEvidenceWithoutContext(handle, job, device, () => undefined),
  );

  const artifact = job.artifacts.find((item) => item.kind === "network");
  assert.ok(artifact);
  const data = artifact.data as {
    entries?: unknown[];
    androidPacketCapture?: { status?: string; stage?: string; message?: string };
  };
  assert.equal(data.entries?.length, 1);
  assert.equal(data.androidPacketCapture?.status, "failed");
  assert.equal(data.androidPacketCapture?.stage, "start");
  assert.match(data.androidPacketCapture?.message ?? "", /AVD directory disappeared/u);
  assert.equal(handle.manifest.channels.network.status, "partial");
  assert.match(handle.manifest.channels.network.message ?? "", /AVD directory disappeared/u);
});

test("bound Android diagnostics do not depend on a responsive UI snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const calls: string[] = [];
  const device = {
    apps: {
      open: async () => {
        calls.push("bind");
        return { appId: "com.example.app" };
      },
    },
    capture: {
      snapshot: async () => {
        calls.push("prime");
        throw new Error("Android evidence session timed out");
      },
    },
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
    serial: testTarget.serial,
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
  } as unknown as TestJob;

  try {
    const handle = await startRunEvidence(job, device, () => undefined, undefined, {
      foregroundAppResolver: async () => "com.example.app",
    });
    await stopRunEvidence(handle, job, device, () => undefined);

    // Release the encoder before collecting the final performance sample so
    // slow recorder shutdown cannot consume the evidence-stop deadline.
    assert.deepEqual(calls, ["bind", "perf", "start", "stop", "perf"]);
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

test("redacted frozen visual policy does not start or persist generic device video", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-redacted-video-"));
  const calls: string[] = [];
  const device = {
    recording: {
      record: async (options: { action: "start" | "stop" }) => {
        calls.push(options.action);
        return { started: true };
      },
    },
  } as unknown as Device;
  const job = {
    id: "redacted-video-run",
    action: "chat-smoke",
    serial: testTarget.serial,
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
    title: "Redacted video",
    runDir: root,
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: {
      schemaVersion: 1,
      sensitive: {},
      redaction: { enabled: true, source: "workspace", locked: false },
    },
  } as unknown as TestJob;

  try {
    const handle = await startRunEvidence(job, device, () => undefined);
    await stopRunEvidence(handle, job, device, () => undefined);

    assert.deepEqual(calls, []);
    assert.equal(handle.recordingStarted, false);
    assert.equal(handle.manifest.channels.video.status, "redacted");
    assert.equal(
      job.artifacts.some(
        (artifact) => artifact.kind === "video-start" || artifact.kind === "video",
      ),
      false,
    );
    await assert.rejects(access(join(root, "video")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("campaign runs keep step frames without paying for duplicate full-run video", async () => {
  let videoCalls = 0;
  let performanceCalls = 0;
  const job = {
    id: "campaign-evidence-run",
    action: "app-map:test",
    serial: testTarget.serial,
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
    title: "Campaign",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
    recipeSnapshot: {
      schemaVersion: 1,
      id: "campaign",
      title: "Campaign",
      steps: [{ kind: "screenshot", check: { id: "screen", title: "Screen" } }],
    },
  } as unknown as TestJob;
  const device = {
    capture: { snapshot: async () => ({ nodes: [] }) },
    observability: {
      perf: async () => {
        performanceCalls += 1;
        return {};
      },
    },
    recording: {
      record: async () => {
        videoCalls += 1;
        return {};
      },
    },
  } as unknown as Device;

  const handle = await startRunEvidence(job, device, () => undefined, undefined, {
    foregroundAppResolver: async () => undefined,
  });
  await stopRunEvidence(handle, job, device, () => undefined);

  assert.equal(videoCalls, 0);
  assert.equal(performanceCalls, 0);
  assert.equal(handle.manifest.channels.performance.status, "unsupported");
  assert.match(handle.manifest.channels.performance.message ?? "", /Android app session/);
  assert.equal(handle.manifest.channels.logs.status, "unsupported");
  assert.equal(handle.manifest.channels.network.status, "unsupported");
  assert.equal(handle.manifest.channels.video.status, "unsupported");
  assert.match(handle.manifest.channels.video.message ?? "", /step-scoped campaign frames/);
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

test("sensitive consent events use only known manifest channels", () => {
  const grant = { grantedAt: 1, grantedBy: "tester", reason: "contract test" };
  const job = {
    id: "evidence-channel-contract",
    action: "chat-smoke",
    platform: "android",
    targetContext: testTarget,
    status: "running",
    queuedAt: 1,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Evidence channel contract",
    artifacts: [],
    resolvedInputs: {},
    // Simulate a legacy/unknown persisted key: it must not become an
    // arbitrary manifest channel through a type assertion.
    evidencePolicy: {
      schemaVersion: 1,
      sensitive: {
        "network-raw": grant,
        "future-channel": grant,
      },
    },
  } as unknown as TestJob;

  const handle = initializeRunEvidence(job);
  const consentEvents = handle.manifest.events.filter((item) => item.kind === "consent.granted");
  assert.deepEqual(
    consentEvents.map((item) => item.channel),
    ["network"],
  );
  assert.equal(consentEvents[0]?.data && typeof consentEvents[0].data === "object", true);
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

test("cancelled evidence keeps buffered observations without querying the destroyed session", async () => {
  const job = {
    id: "cancelled-buffered-evidence",
    action: "cancelled",
    platform: "android",
    targetContext: testTarget,
    status: "cancelled",
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 20,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [{ path: "frames/001.png", caption: "last observation", capturedAt: 10, bytes: 5 }],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Cancelled evidence",
    artifacts: [
      {
        kind: "ui-tree",
        capturedAt: 9,
        data: { phase: "after", nodes: [{ label: "Last known state" }] },
      },
    ],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;
  const handle = initializeRunEvidence(job);
  job.startedAt = handle.startedAt;
  job.finishedAt = handle.startedAt + 20;
  job.frames[0]!.capturedAt = handle.startedAt + 10;
  job.artifacts[0]!.capturedAt = handle.startedAt + 9;
  handle.logsStarted = true;
  handle.performanceStarted = true;
  handle.manifest.channels.logs.status = "captured";
  handle.manifest.channels.performance.status = "captured";
  let deadAdapterQueries = 0;
  const destroyed = new Proxy(
    {},
    {
      get() {
        deadAdapterQueries += 1;
        throw new Error("destroyed session was queried");
      },
    },
  ) as Device;

  await stopRunEvidence(
    handle,
    job,
    runEvidenceFinalizationDevice(job.status, destroyed),
    () => undefined,
  );

  assert.equal(deadAdapterQueries, 0);
  assert.equal(job.evidence?.channels.screenshot.entries, 1);
  assert.equal(job.evidence?.channels["ui-tree"].entries, 1);
  assert.equal(job.evidence?.channels.logs.status, "partial");
  assert.equal(
    job.evidence?.events.find((event) => event.kind === "run.finished")?.at,
    job.finishedAt,
  );
});
