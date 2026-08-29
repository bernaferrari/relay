import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compileBrowserEnvironment,
  type BrowserProofEvidence,
  type TargetProfile,
} from "@relay/protocol";
import { closeBrowserHostPool } from "./browser-host-pool.js";
import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";
import { captureBrowserProofEvidence } from "./browser-proof-evidence-runtime.js";
import type { BrowserProofRuntime } from "./browser-proof-runtime.js";
import { closeBrowserTarget, getBrowserDevice } from "./browser-target.js";
import { loadRedactionPolicy } from "./redaction.js";
import { initializeRunEvidence, stopRunEvidence } from "./run-evidence.js";
import { exportTracePack, verifyTracePack } from "./trace-pack.js";
import type { PersistedRun } from "./runs.js";
import type { TestJob } from "./session.js";
import { deleteTarget, saveBrowserTarget } from "./targets.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("fixture did not bind"));
      else resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("browser proof collection denies visual and body secrets before durable writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-proof-policy-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousRedaction = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_REDACTION_MODE = "off";
  await loadRedactionPolicy();
  const environment = compileBrowserEnvironment({ viewport: { width: 800, height: 600 } });
  const calls = { screenshot: 0, accessibility: 0, pages: 0, trace: 0 };
  const runtime: BrowserProofRuntime = {
    profile: environment,
    version: "test-browser",
    screenshot: async () => {
      calls.screenshot += 1;
    },
    ariaSnapshot: async () => {
      calls.accessibility += 1;
      return "semantic secret sentinel";
    },
    pages: async () => {
      calls.pages += 1;
      return {
        pages: [
          {
            id: "page-1",
            kind: "page",
            title: "secret sentinel",
            url: "https://example.test/?token=secret-sentinel",
            active: true,
            closed: false,
          },
        ],
        dropped: 0,
      };
    },
    console: [{ level: "error", text: "Authorization: Bearer secret-sentinel", at: 1 }],
    consoleDropped: 0,
    pageErrors: [{ at: 1, source: "page", message: "Cookie: secret-sentinel" }],
    pageErrorsDropped: 0,
    network: [
      {
        method: "POST",
        url: "https://example.test/api?token=secret-sentinel",
        status: 200,
        at: 1,
        requestHeaders: { Authorization: "Bearer secret-sentinel" },
        requestBody: "request secret sentinel",
        responseHeaders: { "set-cookie": "session=secret-sentinel" },
        responseBody: "response secret sentinel",
        responseBodyEncoding: "utf8",
      },
    ],
    networkDropped: 0,
    stopTrace: async () => {
      calls.trace += 1;
    },
  };
  const runDir = join(root, "run");
  try {
    const evidence = await captureBrowserProofEvidence({
      targetId: "policy-target",
      runId: "policy-run",
      targetProfileId: "policy-profile",
      sourceSha: "a".repeat(40),
      artifactDigest: `sha256:${"b".repeat(64)}`,
      environment,
      runDir,
      evidencePolicy: {
        schemaVersion: 1,
        sensitive: {},
        redaction: { enabled: true, source: "workspace", locked: false },
      },
      runtime,
    });
    assert.equal(evidence.completeness.status, "partial");
    assert.deepEqual(evidence.completeness.missing, [
      "screenshot",
      "accessibility",
      "trace",
      "popup-topology",
    ]);
    for (const name of ["screenshot", "accessibility", "trace", "popup-topology"] as const) {
      assert.equal(evidence.channels[name].status, "denied");
      assert.equal(evidence.channels[name].redactions, 1);
    }
    assert.equal(calls.screenshot, 0);
    assert.equal(calls.accessibility, 0);
    assert.equal(calls.pages, 0);
    assert.equal(calls.trace, 0);
    for (const path of [
      "browser/checkpoint.png",
      "browser/accessibility.json",
      "browser/trace.zip",
      "browser/popup-topology.json",
    ]) {
      await assert.rejects(stat(join(runDir, path)), path);
    }
    const consoleArtifact = await readFile(join(runDir, "browser/console-errors.json"), "utf8");
    const networkArtifact = await readFile(join(runDir, "browser/network.json"), "utf8");
    assert.doesNotMatch(consoleArtifact, /secret-sentinel/u);
    assert.doesNotMatch(networkArtifact, /secret-sentinel/u);
    assert.equal(evidence.channels["console-errors"].redactions, 1);
    assert.equal(evidence.channels["page-errors"].redactions, 1);
    assert.equal(evidence.channels.network.redactions, 1);
    const network = JSON.parse(networkArtifact) as { entries: Array<Record<string, unknown>> };
    const firstEntry = network.entries[0];
    assert.ok(firstEntry);
    assert.equal(firstEntry.requestBody, undefined);
    assert.equal(firstEntry.responseBody, undefined);
    assert.equal((firstEntry.requestHeaders as Record<string, string>).Authorization, "[REDACTED]");
  } finally {
    if (previousRedaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousRedaction;
    await loadRedactionPolicy();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("production browser proof captures one complete artifact across multiple steps", async (t) => {
  await access(CHROME).catch(() => t.skip("Google Chrome is not installed"));
  if (t.signal.aborted) return;

  const root = await mkdtemp(join(tmpdir(), "relay-browser-proof-runtime-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const server = http.createServer((request, response) => {
    if (request.url === "/abort") {
      // A reset connection exercises Playwright's requestfailed event. It is
      // intentionally distinct from the HTTP-error response below.
      response.destroy();
      return;
    }
    if (request.url === "/http-error") {
      response.statusCode = 503;
      response.setHeader("content-type", "text/plain");
      response.end("unavailable");
      return;
    }
    if (request.url === "/popup") {
      response.setHeader("content-type", "text/html");
      response.end("<title>Popup</title><p>Popup content</p>");
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html>
      <title>Proof fixture</title>
      <main><h1>Settings</h1><button>Continue</button></main>
      <script>
        console.error("proof-console-error");
        window.open("/popup", "proof-popup");
        fetch("/abort").catch(() => undefined);
        fetch("/http-error").catch(() => undefined);
        setTimeout(() => { throw new Error("proof-page-error"); }, 20);
      </script>`);
  });
  const port = await listen(server);
  const target = await saveBrowserTarget({
    id: "browser-proof-runtime-e2e",
    name: "Browser proof runtime fixture",
    startUrl: `http://127.0.0.1:${port}/`,
    executablePath: CHROME,
    headless: true,
    environment: {
      viewport: { width: 800, height: 600 },
      locale: "en-US",
      timezoneId: "UTC",
    },
  });
  const environment = browserCaseProfileForTarget(target);
  const runDir = join(root, "run");
  let closed = false;
  try {
    const device = await getBrowserDevice(target.id, {
      mode: "proof",
      profile: environment,
      recordVideo: false,
    });
    await device.capture.snapshot({ platform: "android" });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const targetProfile: TargetProfile = {
      id: "browser-proof-runtime-profile",
      targetId: target.id,
      source: "browser",
      platform: "browser",
      name: target.name,
      viewport: environment.viewport,
      browserCaseProfile: environment,
      capabilities: ["snapshot", "screenshot", "network", "logs"],
      observedAt: 1,
    };
    const job = {
      id: "browser-proof-runtime-run",
      action: "browser-proof-checkpoint",
      targetContext: { kind: "browser", platform: "browser", targetId: target.id },
      targetKind: "browser",
      browserTargetId: target.id,
      platform: "browser",
      targetProfile,
      browserCaseProfile: environment,
      sourceRevision: {
        vcs: "git",
        sha: "a".repeat(40),
        artifactDigest: `sha256:${"b".repeat(64)}`,
      },
      status: "running",
      queuedAt: 1,
      attempts: 1,
      logs: [],
      steps: [
        { id: "step-one", actions: [], frames: [] },
        { id: "step-two", actions: [], frames: [] },
      ],
      frames: [],
      glyphs: [],
      kind: "Replay",
      tone: "acc",
      title: "Browser proof checkpoint",
      runDir,
      artifacts: [],
      resolvedInputs: {},
      evidencePolicy: { schemaVersion: 1, sensitive: {} },
    } as unknown as TestJob;
    const handle = initializeRunEvidence(job);
    await stopRunEvidence(handle, job, device, () => undefined);
    const browserArtifacts = job.artifacts.filter((item) => item.kind === "browser-proof-evidence");
    assert.equal(browserArtifacts.length, 1, "multi-step Runs emit exactly one browser artifact");
    const evidence = browserArtifacts[0]!.data as BrowserProofEvidence;

    assert.equal(evidence.completeness.status, "complete");
    assert.deepEqual(evidence.completeness.missing, []);
    assert.ok(evidence.popupTopology?.pages.length);
    assert.ok(evidence.consoleErrors?.messages.includes("proof-console-error"));
    assert.ok(evidence.pageErrors?.messages.includes("proof-page-error"));
    assert.ok((evidence.networkSummary?.statusCodes["503"] ?? 0) >= 1);

    const network = JSON.parse(await readFile(join(runDir, "browser/network.json"), "utf8")) as {
      entries: Array<{ status?: number; failed?: boolean; failureText?: string }>;
    };
    assert.ok(
      network.entries.some((entry) => entry.failed === true || entry.failureText !== undefined),
      "requestfailed must be retained separately from HTTP error responses",
    );
    for (const path of [
      "browser/checkpoint.png",
      "browser/accessibility.json",
      "browser/console-errors.json",
      "browser/page-errors.json",
      "browser/network.json",
      "browser/trace.zip",
      "browser/popup-topology.json",
    ]) {
      assert.ok((await stat(join(runDir, path))).size > 0, path);
    }

    // Exercise the actual portable closure, not only local file creation:
    // every browser channel ref must become an embedded TracePack object and
    // survive the same integrity/binding verifier used by offline analysis.
    const run = {
      schemaVersion: 5,
      id: job.id,
      action: job.action,
      serial: target.id,
      platform: "browser",
      executionTarget: {
        schemaVersion: 1,
        kind: "local-browser",
        provider: { key: "relay.local.browser", scope: "local" },
        targetId: target.id,
        platform: "browser",
        identity: { kind: "browser-target", value: target.id },
      },
      targetProfile,
      browserCaseProfile: environment,
      sourceRevision: job.sourceRevision,
      status: "ok",
      attempts: 1,
      queuedAt: 1,
      startedAt: 2,
      finishedAt: 3,
      logs: [],
      steps: [],
      frames: [],
      dir: runDir,
      writtenAt: 3,
      artifacts: job.artifacts,
      inputDigest: "c".repeat(64),
      resolvedInputs: {},
      evidence: job.evidence,
    } as unknown as PersistedRun;
    const pack = await exportTracePack(run);
    assert.equal(pack.browserEvidence?.runId, job.id, JSON.stringify(pack.completeness.missing));
    assert.equal(
      pack.completeness.artifacts?.filter(({ status }) => status === "embedded").length,
      7,
    );
    assert.deepEqual(verifyTracePack(pack), pack);
  } finally {
    if (!closed) {
      closed = true;
      await closeBrowserTarget(target.id, { mode: "proof" }).catch(() => undefined);
    }
    await closeBrowserHostPool().catch(() => undefined);
    await deleteTarget(target.id).catch(() => undefined);
    await close(server);
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
