import { expect, test } from "vitest";
import { render } from "solid-js/web";
import type { RunEvidenceQuery } from "@relay/protocol";
import { RunNetworkEvidence } from "./run-evidence-panels";

function packetEvidence(): RunEvidenceQuery {
  return {
    schemaVersion: 1,
    runId: "run-network",
    generatedAt: 2_000,
    target: { platform: "android", serial: "emulator-5554", name: "medium_phone" },
    channels: {
      network: {
        channel: "network",
        status: "partial",
        startedAt: 1_000,
        finishedAt: 2_000,
        entries: 1,
        bytes: 768,
        dropped: 0,
        redactions: 0,
      },
    },
    logs: [],
    network: [],
    networkCapture: {
      mode: "emulator-packet",
      label: "Android emulator packets and app session logs",
      detail: "Packet metadata is partial; application HTTP details are opportunistic.",
    },
    androidNetwork: {
      schemaVersion: 1,
      source: { kind: "emulator-packet", backend: "android-emulator-console" },
      coverage: "partial",
      scope: "entire-emulator",
      startedAt: 1_000,
      finishedAt: 2_000,
      packets: 4,
      bytesSent: 512,
      bytesReceived: 256,
      domains: ["example.com"],
      flows: [
        {
          protocol: "tls",
          remoteAddress: "203.0.113.10",
          port: 443,
          startedAtMs: 100,
          sentBytes: 512,
          receivedBytes: 256,
          outcome: "connected",
        },
      ],
      attribution: {
        package: "com.example.app",
        uid: 10_123,
        rxBytesDelta: 256,
        txBytesDelta: 512,
        confidence: "mixed",
        reason: "Flows include the entire emulator.",
      },
      rawCapture: { status: "not-requested" },
      dropped: 0,
      redactions: 0,
      limitations: ["Netsim Wi-Fi traffic may be absent."],
    },
    performance: [],
    crashes: [],
    artifacts: [],
    events: [],
    limits: { requested: 100, applied: 100, bodiesIncluded: false },
    notes: [],
  };
}

test("presents Android packet facts without inventing decrypted HTTP evidence", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => <RunNetworkEvidence evidence={packetEvidence()} loading={false} />,
    root,
  );

  expect(root.textContent).toContain("Emulator packet summary");
  expect(root.textContent).toContain("Entire-emulator transport metadata");
  expect(root.textContent).toContain("does not parse HTTP methods, statuses, headers, or bodies");
  expect(root.textContent).toContain("No app-reported HTTP or WebSocket exchanges were observed");
  expect(root.textContent).toContain("Raw packets: Not requested");
  expect(root.textContent).not.toContain("GET");
  expect(root.textContent).not.toContain("200");

  const details = root.querySelector("details");
  expect(details?.textContent).toContain("Inspect transport flows and coverage limits");
  details!.open = true;
  expect(details?.textContent).toContain("203.0.113.10:443");
  expect(details?.textContent).toContain("Netsim Wi-Fi traffic may be absent.");

  dispose();
  root.remove();
});
