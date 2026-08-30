import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Device } from "./device.js";
import { exportTracePack } from "./trace-pack.js";
import {
  startRunEvidence as startRunEvidenceWithoutContext,
  stopRunEvidence as stopRunEvidenceWithoutContext,
} from "./run-evidence.js";
import { persistRun } from "./runs.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

const target = { kind: "device", platform: "android", serial: "trace-pack-evidence" } as const;

const startRunEvidence: typeof startRunEvidenceWithoutContext = (...args) =>
  runWithTargetContext(target, () => startRunEvidenceWithoutContext(...args));
const stopRunEvidence: typeof stopRunEvidenceWithoutContext = (...args) =>
  runWithTargetContext(target, () => stopRunEvidenceWithoutContext(...args));

test("Android logs and network evidence are owned by the Run before TracePack export", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-trace-pack-android-evidence-"));
  const providerRoot = await mkdtemp(join(tmpdir(), "relay-trace-pack-android-provider-"));
  const providerLog = join(providerRoot, "app.log");
  await writeFile(providerLog, providerLogContent());
  await mkdir(join(root, "frames"), { recursive: true });
  await writeFile(join(root, "frames", "001.png"), "frame");
  const job = {
    id: "android-observability-run",
    action: "android-proof",
    serial: target.serial,
    platform: "android",
    targetKind: "device",
    targetContext: target,
    runDir: root,
    status: "running",
    queuedAt: 1,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Android proof",
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
      logs: async (input: { action?: string }) =>
        input.action === "start"
          ? { path: providerLog, started: true }
          : { path: providerLog, stopped: true },
      network: async (input: { action?: string }) =>
        input.action === "log"
          ? { path: providerLog, entries: [] }
          : {
              path: providerLog,
              entries: [
                {
                  method: "GET",
                  url: "https://example.test/settings",
                  status: 200,
                  raw: "Authorization: Bearer network-secret",
                },
              ],
              scannedLines: 1,
              matchedLines: 1,
            },
    },
    recording: {
      record: async (input: { action?: string }) =>
        input.action === "start"
          ? { started: false, warning: "video unavailable in unit test" }
          : { stopped: true },
    },
  } as unknown as Device;

  job.frames.push({ path: "frames/001.png", caption: "proof", capturedAt: 1, bytes: 5 });
  job.artifacts.push({
    kind: "ui-tree",
    capturedAt: 1,
    data: { stepId: "proof", phase: "after", nodes: [{ label: "Settings" }] },
  });

  try {
    const handle = await startRunEvidence(
      job,
      device,
      () => undefined,
      undefined,
      { foregroundAppResolver: async () => "com.example.app" },
    );
    await stopRunEvidence(handle, job, device, () => undefined);

    job.status = "ok";
    job.finishedAt = 2;
    const run = await persistRun(job);
    const pack = await exportTracePack(run);

    assert.equal(pack.completeness.status, "complete", JSON.stringify(pack.completeness));
    assert.equal(pack.completeness.missing.length, 0);
    assert.equal(pack.completeness.artifacts?.every((item) => item.status === "embedded"), true);
    assert.equal(JSON.stringify(pack).includes(providerRoot), false);
    assert.equal(JSON.stringify(pack).includes("network-secret"), false);
    assert.deepEqual(
      run.artifacts
        .filter((artifact) => artifact.kind === "logs" || artifact.kind === "network")
        .map((artifact) => (artifact.data as { path?: string }).path),
      ["logs/app.log", "network/network.json"],
    );
    assert.equal(await readFile(join(root, "logs", "app.log"), "utf8"), ownedLogContent());
    assert.match(await readFile(join(root, "network", "network.json"), "utf8"), /example\.test/u);
    assert.equal((await stat(join(root, "logs"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, "network"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, "logs", "app.log"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "network", "network.json"))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(providerRoot, { recursive: true, force: true });
  }
});

function providerLogContent(): string {
  return "GET https://example.test/settings?token=log-secret status=200 Authorization: Bearer log-secret\n";
}

function ownedLogContent(): string {
  return "GET https://example.test/settings?[REDACTED] status=200 Authorization: Bearer [REDACTED]\n";
}
