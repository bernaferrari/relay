import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { PersistedRun } from "@relay/core";
import { handleRunRoute } from "./run-routes.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "local-user",
  organizationId: "local",
  projectId: "local",
  allowedProjects: ["local"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

class CapturedResponse {
  status = 0;
  body = "";

  writeHead(status: number): this {
    this.status = status;
    return this;
  }

  end(chunk?: string | Buffer): this {
    this.body += chunk?.toString() ?? "";
    return this;
  }
}

test("run evidence HTTP adapter preserves typed packet provenance and parse failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-evidence-network-route-"));
  const dir = join(root, "network-contract-run");
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const run: PersistedRun = {
    schemaVersion: 4,
    id: "network-contract-run",
    projectId: "local",
    ownerId: "local-user",
    action: "android-proof",
    serial: "emulator-5554",
    platform: "android",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    logs: [],
    steps: [],
    frames: [],
    dir,
    writtenAt: 2,
    artifacts: [
      {
        kind: "network",
        capturedAt: 2,
        data: {
          entries: [{ method: "GET", url: "https://example.test/health", status: 200 }],
          androidNetwork: {
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
          },
        },
      },
    ],
    inputDigest: "a".repeat(64),
    resolvedInputs: {},
  };
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(run));
    const request = Readable.from([]) as unknown as http.IncomingMessage;
    request.headers = {};
    const response = new CapturedResponse();
    const handled = await handleRunRoute({
      method: "GET",
      pathname: "/runs/network-contract-run/evidence",
      url: new URL("http://localhost/runs/network-contract-run/evidence"),
      request,
      response: response as unknown as http.ServerResponse,
      scope,
    });
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body) as {
      evidence: {
        networkCapture: { mode: string; label: string };
        androidNetwork?: { source: { kind: string }; parseFailure?: { kind: string } };
        network: unknown[];
      };
    };
    assert.equal(body.evidence.networkCapture.mode, "emulator-packet");
    assert.match(body.evidence.networkCapture.label, /partial parse/u);
    assert.equal(body.evidence.androidNetwork?.source.kind, "emulator-packet");
    assert.equal(body.evidence.androidNetwork?.parseFailure?.kind, "packet-parse-failure");
    assert.equal(body.evidence.network.length, 1);
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
