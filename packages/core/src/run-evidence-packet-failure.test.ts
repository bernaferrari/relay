import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Device } from "./device.js";
import {
  startRunEvidence as startRunEvidenceWithoutContext,
  stopRunEvidence as stopRunEvidenceWithoutContext,
} from "./run-evidence.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

test("packet finalize failure remains typed and partial when the session log succeeds", async () => {
  const avdDirectory = await mkdtemp(join(tmpdir(), "relay-run-packet-finalize-failure-"));
  const target = { kind: "device", platform: "android", serial: "emulator-5564" } as const;
  const job = {
    id: "emulator-packet-finalize-failure",
    action: "proof",
    serial: target.serial,
    platform: "android",
    targetKind: "device",
    targetContext: target,
    targetProfile: {
      id: "device:emulator-5564",
      targetId: target.serial,
      source: "device",
      platform: "android",
      name: "Medium phone",
      androidAvdName: "medium_phone",
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
    title: "Emulator packet finalize failure",
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

  try {
    const handle = await runWithTargetContext(target, () =>
      startRunEvidenceWithoutContext(job, device, () => undefined, undefined, {
        foregroundAppResolver: async () => "com.example.app",
        androidPacketRuntime: {
          now: () => 1_000,
          resolveAvdDirectory: async () => avdDirectory,
          readLocalAddresses: async () => ["10.0.2.15"],
          execAdb: async (args) => {
            if (args.includes("start")) {
              await mkdir(join(avdDirectory, "console_out"), { recursive: true });
              await writeFile(args.at(-1)!, Buffer.from("not-a-pcap"));
            }
            return { stdout: "OK", stderr: "" };
          },
        },
      }),
    );
    await runWithTargetContext(target, () =>
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
    assert.equal(data.androidPacketCapture?.stage, "finalize");
    assert.match(data.androidPacketCapture?.message ?? "", /no PCAP header/u);
    assert.equal(handle.manifest.channels.network.status, "partial");
    assert.match(handle.manifest.channels.network.message ?? "", /no PCAP header/u);
  } finally {
    await rm(avdDirectory, { recursive: true, force: true });
  }
});
