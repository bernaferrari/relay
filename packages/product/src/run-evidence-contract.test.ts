import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidNetworkEvidenceSummary, type RunEvidenceQuery } from "@relay/protocol";

test("product-facing run evidence keeps packet provenance distinct from session logs", () => {
  const summary = parseAndroidNetworkEvidenceSummary({
    schemaVersion: 1,
    source: { kind: "emulator-packet", backend: "android-emulator-console" },
    coverage: "partial",
    scope: "entire-emulator",
    startedAt: 1,
    finishedAt: 2,
    packets: 0,
    bytesSent: 0,
    bytesReceived: 0,
    domains: [],
    flows: [],
    attribution: { confidence: "unavailable", reason: "No package" },
    rawCapture: { status: "not-requested", retention: "ephemeral" },
    parseFailure: {
      kind: "packet-parse-failure",
      message: "Emulator packet capture has no PCAP header",
    },
    dropped: 1,
    redactions: 0,
    limitations: ["Packet summary parsing was incomplete"],
  });
  const evidence = {
    androidNetwork: summary,
    networkCapture: {
      mode: "emulator-packet" as const,
      label: "Emulator packet metadata · partial parse",
      detail: "Packet summary parsing was incomplete",
    },
  } as Pick<RunEvidenceQuery, "androidNetwork" | "networkCapture">;

  assert.ok(evidence.androidNetwork);
  assert.equal(evidence.androidNetwork.source.kind, "emulator-packet");
  assert.equal(evidence.androidNetwork.parseFailure?.kind, "packet-parse-failure");
  assert.equal(evidence.networkCapture.mode, "emulator-packet");
  assert.doesNotMatch(evidence.networkCapture.label, /session-log/u);
});
