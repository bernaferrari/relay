import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAndroidNetworkEvidenceSummary,
  parseAndroidPacketCaptureProvenance,
} from "./android-network-evidence.js";

function packetSummary() {
  return {
    schemaVersion: 1 as const,
    source: {
      kind: "emulator-packet" as const,
      backend: "android-emulator-tcpdump" as const,
    },
    coverage: "packet-complete" as const,
    scope: "entire-emulator" as const,
    startedAt: 1_000,
    finishedAt: 2_000,
    packets: 4,
    bytesSent: 120,
    bytesReceived: 480,
    domains: ["api.example.test"],
    flows: [
      {
        protocol: "tls" as const,
        host: "api.example.test",
        port: 443,
        startedAtMs: 12,
        durationMs: 30,
        sentBytes: 120,
        receivedBytes: 480,
        outcome: "connected" as const,
      },
    ],
    attribution: {
      package: "com.example.app",
      uid: 10_142,
      rxBytesDelta: 480,
      txBytesDelta: 120,
      confidence: "high" as const,
      reason: "Dedicated emulator and UID counters agree with the packet window",
    },
    rawCapture: { status: "not-requested" as const },
    dropped: 0,
    redactions: 1,
    limitations: ["HTTPS payloads were not decrypted"],
  };
}

test("packet-complete Android evidence requires one closed lossless packet window", () => {
  assert.deepEqual(parseAndroidNetworkEvidenceSummary(packetSummary()), packetSummary());
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        finishedAt: undefined,
        dropped: 1,
      }),
    /closed window with no dropped packets/u,
  );
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        source: { kind: "emulator-packet", backend: "android-emulator-console" },
      }),
    /cannot claim packet-complete/u,
  );
});

test("app-session logs can claim only opportunistic coverage", () => {
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        source: {
          kind: "app-session-log",
          backend: "agent-device-session-log",
        },
      }),
    /must be opportunistic/u,
  );
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        source: { kind: "app-session-log", backend: "android-emulator-console" },
        coverage: "opportunistic",
        scope: "session-log",
      }),
    /session-log backend/u,
  );
});

test("packet flows cannot invent encrypted HTTP facts", () => {
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        flows: [{ ...packetSummary().flows[0], method: "POST", status: 200 }],
      }),
    /unrecognized_keys|method|status/u,
  );
});

test("raw packet bytes are addressable only when capture succeeded", () => {
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        rawCapture: {
          status: "denied",
          artifact: { path: "network/capture.pcap", bytes: 600 },
        },
      }),
    /only captured or truncated raw network evidence/u,
  );
  assert.doesNotThrow(() =>
    parseAndroidNetworkEvidenceSummary({
      ...packetSummary(),
      rawCapture: {
        status: "captured",
        artifact: { path: "network/capture.pcap", bytes: 600 },
        bytes: 600,
      },
    }),
  );
  for (const path of ["/tmp/capture.pcap", "../capture.pcap", "network/../capture.pcap"]) {
    assert.throws(() =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        rawCapture: {
          status: "captured",
          artifact: { path, bytes: 600 },
          bytes: 600,
        },
      }),
    );
  }
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        rawCapture: {
          status: "captured",
          artifact: { path: "network/raw.json", bytes: 600 },
          bytes: 600,
        },
      }),
    /PCAP or PCAPNG/u,
  );
});

test("packet source, scope, attribution, and flow window stay mutually consistent", () => {
  assert.throws(
    () => parseAndroidNetworkEvidenceSummary({ ...packetSummary(), scope: "target-application" }),
    /entire-emulator scope/u,
  );
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        attribution: { confidence: "high", reason: "Unfounded attribution" },
      }),
    /high-confidence attribution/u,
  );
  assert.throws(
    () =>
      parseAndroidNetworkEvidenceSummary({
        ...packetSummary(),
        flows: [{ ...packetSummary().flows[0], startedAtMs: 999, durationMs: 2 }],
      }),
    /exceeds the captured Run window/u,
  );
});

test("packet collector provenance distinguishes capture from start and finalize failures", () => {
  const failed = parseAndroidPacketCaptureProvenance({
    schemaVersion: 1,
    status: "failed",
    source: { kind: "emulator-packet", backend: "android-emulator-console" },
    scope: "entire-emulator",
    startedAt: 1_000,
    finishedAt: 1_001,
    stage: "start",
    message: "Managed emulator capture command was unavailable",
  });
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") assert.equal(failed.stage, "start");
  assert.equal(
    parseAndroidPacketCaptureProvenance({
      schemaVersion: 1,
      status: "captured",
      source: { kind: "emulator-packet", backend: "android-emulator-tcpdump" },
      scope: "entire-emulator",
      startedAt: 1_000,
      finishedAt: 2_000,
      coverage: "packet-complete",
    }).status,
    "captured",
  );
  assert.throws(
    () =>
      parseAndroidPacketCaptureProvenance({
        schemaVersion: 1,
        status: "failed",
        source: { kind: "app-session-log", backend: "agent-device-session-log" },
        scope: "session-log",
        startedAt: 1_000,
        finishedAt: 2_000,
        stage: "start",
        message: "Wrong collector",
      }),
    /invalid_value|emulator-packet|entire-emulator/u,
  );
});
