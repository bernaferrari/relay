import assert from "node:assert/strict";
import test from "node:test";
import { buildRunEvidence } from "./run-observatory.js";
import type { PersistedRun } from "./runs.js";

function run(overrides: Partial<PersistedRun> = {}): PersistedRun {
  return {
    schemaVersion: 5,
    id: "run-1",
    projectId: "project-1",
    action: "checkout",
    serial: "pixel-9",
    platform: "android",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    logs: [],
    steps: [],
    frames: [],
    dir: "/tmp/run-1",
    writtenAt: 10,
    artifacts: [],
    inputDigest: "digest",
    resolvedInputs: {},
    ...overrides,
  };
}

test("buildRunEvidence normalizes device logs and network exchanges", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        {
          kind: "logs",
          capturedAt: 20,
          data: {
            entries: [{ at: 21, level: "ERROR", tag: "Checkout", message: "Payment failed" }],
          },
        },
        {
          kind: "network",
          capturedAt: 22,
          data: {
            entries: [
              {
                at: 23,
                method: "post",
                url: "https://example.test/pay",
                status: 500,
                durationMs: 42,
              },
            ],
          },
        },
      ],
      evidence: {
        schemaVersion: 1,
        runId: "run-1",
        target: { kind: "device", platform: "android", id: "pixel-9" },
        startedAt: 1,
        channels: {
          input: {
            channel: "input",
            status: "captured",
            entries: 1,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          screenshot: {
            channel: "screenshot",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          video: {
            channel: "video",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          "ui-tree": {
            channel: "ui-tree",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          logs: {
            channel: "logs",
            status: "captured",
            entries: 1,
            bytes: 10,
            dropped: 0,
            redactions: 0,
          },
          network: {
            channel: "network",
            status: "captured",
            entries: 1,
            bytes: 10,
            dropped: 0,
            redactions: 0,
          },
          performance: {
            channel: "performance",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          crash: {
            channel: "crash",
            status: "denied",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          audio: {
            channel: "audio",
            status: "denied",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
        },
        events: [],
      },
    }),
  );

  assert.equal(evidence.logs[0]?.level, "error");
  assert.equal(evidence.logs[0]?.source, "Checkout");
  assert.equal(evidence.network[0]?.method, "POST");
  assert.equal(evidence.network[0]?.result, "failure");
  assert.equal(evidence.network[0]?.status, 500);
  assert.deepEqual(
    evidence.events.map((event) => [event.channel, event.at, event.tone]),
    [
      ["log", 21, "critical"],
      ["network", 23, "critical"],
    ],
  );
  assert.equal(evidence.limits.bodiesIncluded, false);
});

test("buildRunEvidence places every evidence channel on one chronological clock", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        { kind: "crash", capturedAt: 40, data: { message: "App stopped" } },
        { kind: "logs", capturedAt: 10, data: { entries: ["Started"] } },
        { kind: "performance-start", capturedAt: 20, data: { cpu: 12 } },
        { kind: "screenshot", capturedAt: 30, data: { message: "Before tap" } },
      ],
    }),
  );

  assert.deepEqual(
    evidence.events.map((event) => [event.channel, event.at]),
    [
      ["log", 10],
      ["performance", 20],
      ["artifact", 30],
      ["crash", 40],
    ],
  );
});

test("buildRunEvidence never exposes network bodies without consent", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        {
          kind: "network",
          capturedAt: 2,
          data: {
            entries: [
              {
                method: "POST",
                url: "https://example.test/pay",
                status: 200,
                requestBody: "card=secret",
                responseBody: "approved",
              },
            ],
          },
        },
      ],
    }),
    { includeBodies: true },
  );
  assert.equal(evidence.limits.bodiesIncluded, false);
  assert.equal(evidence.network[0]?.requestBody, undefined);
  assert.match(evidence.notes.join(" "), /no network-body consent/i);
});

test("buildRunEvidence keeps emulator packet facts separate from HTTP events", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        {
          kind: "network",
          capturedAt: 2_000,
          data: {
            path: "network/network.json",
            entries: [],
            androidNetwork: {
              schemaVersion: 1,
              source: { kind: "emulator-packet", backend: "android-emulator-console" },
              coverage: "partial",
              scope: "entire-emulator",
              startedAt: 1_000,
              finishedAt: 2_000,
              packets: 1,
              bytesSent: 54,
              bytesReceived: 0,
              domains: [],
              flows: [
                {
                  protocol: "tls",
                  remoteAddress: "93.184.216.34",
                  port: 443,
                  startedAtMs: 0,
                  sentBytes: 54,
                  receivedBytes: 0,
                  outcome: "connected",
                },
              ],
              attribution: {
                confidence: "unavailable",
                reason: "No application package was bound to this Run",
              },
              rawCapture: { status: "not-requested" },
              dropped: 0,
              redactions: 0,
              limitations: ["Encrypted HTTP facts were not observed"],
            },
          },
        },
      ],
    }),
  );

  assert.equal(evidence.network.length, 0);
  assert.equal(evidence.androidNetwork?.source.backend, "android-emulator-console");
  assert.equal(evidence.androidNetwork?.flows[0]?.protocol, "tls");
  assert.equal(evidence.networkCapture.mode, "emulator-packet");
  assert.match(evidence.networkCapture.label, /Emulator packet/u);
  assert.match(evidence.networkCapture.detail, /does not parse HTTP methods/u);
});

test("buildRunEvidence preserves typed packet failure beside a successful session log", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        {
          kind: "network",
          capturedAt: 2_000,
          data: {
            entries: [{ method: "GET", url: "https://example.test/health", status: 200 }],
            androidPacketCapture: {
              schemaVersion: 1,
              status: "failed",
              source: { kind: "emulator-packet", backend: "android-emulator-console" },
              scope: "entire-emulator",
              startedAt: 1_000,
              finishedAt: 2_000,
              stage: "start",
              message: "Emulator packet capture could not be started",
            },
          },
        },
      ],
      evidence: {
        schemaVersion: 1,
        runId: "run-1",
        target: { kind: "device", platform: "android", id: "emulator-5554" },
        startedAt: 1,
        channels: {
          network: {
            channel: "network",
            status: "captured",
            entries: 1,
            bytes: 10,
            dropped: 0,
            redactions: 0,
          },
        } as NonNullable<PersistedRun["evidence"]>["channels"],
        events: [],
      },
    }),
  );

  assert.equal(evidence.network.length, 1);
  assert.equal(evidence.androidPacketCapture?.status, "failed");
  assert.equal(
    evidence.androidPacketCapture?.status === "failed"
      ? evidence.androidPacketCapture.stage
      : undefined,
    "start",
  );
  assert.equal(evidence.channels.network?.status, "partial");
  assert.equal(evidence.networkCapture.mode, "session-log");
  assert.match(evidence.networkCapture.label, /packet capture incomplete/u);
});

test("buildRunEvidence fails closed when packet evidence is malformed", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        {
          kind: "network",
          capturedAt: 22,
          data: { androidNetwork: { schemaVersion: 1, coverage: "packet-complete" } },
        },
      ],
      evidence: {
        schemaVersion: 1,
        runId: "run-1",
        target: { kind: "device", platform: "android", id: "emulator-5554" },
        startedAt: 1,
        channels: {
          network: {
            channel: "network",
            status: "captured",
            entries: 1,
            bytes: 10,
            dropped: 0,
            redactions: 0,
          },
        } as NonNullable<PersistedRun["evidence"]>["channels"],
        events: [],
      },
    }),
  );

  assert.equal(evidence.androidNetwork, undefined);
  assert.equal(evidence.channels.network?.status, "partial");
  assert.equal(evidence.networkCapture.mode, "unavailable");
  assert.match(evidence.networkCapture.detail, /malformed/u);
  assert.ok(evidence.notes.some((note) => /malformed/u.test(note)));
});
