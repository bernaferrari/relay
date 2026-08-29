import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_PROOF_REQUIRED_CHANNELS,
  browserProofEvidenceArtifact,
  browserProofEvidenceSchema,
  parseBrowserProofEvidence,
  type BrowserProofEvidence,
} from "./browser-proof-evidence.js";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function profile() {
  return {
    schemaVersion: 1 as const,
    engine: "chromium" as const,
    revision: "chromium-128.0.6613.119",
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark" as const,
    reducedMotion: "no-preference" as const,
    permissions: [],
    offline: false,
    environmentRevision: "web-fixture-v3",
  };
}

function channel(ref: string) {
  return {
    status: "captured" as const,
    entries: 1,
    bytes: 100,
    dropped: 0,
    redactions: 0,
    artifactRefs: [ref],
  };
}

function evidence(): BrowserProofEvidence {
  const channels = {
    screenshot: channel("frames/001.png"),
    accessibility: channel("artifacts/aria-001.json"),
    "console-errors": channel("artifacts/console-001.json"),
    "page-errors": channel("artifacts/page-errors-001.json"),
    network: channel("artifacts/network-001.json"),
    trace: channel("artifacts/trace-001.zip"),
    "popup-topology": channel("artifacts/popups-001.json"),
  };
  return {
    schemaVersion: 1 as const,
    runId: "run-browser-1",
    target: { targetId: "browser-1", targetProfileId: "browser-profile-1" },
    build: { sourceSha: "a".repeat(40), artifactDigest: digest("b") },
    browser: { engine: "chromium" as const, version: profile().revision },
    environment: profile(),
    channels,
    consoleErrors: { messages: [], truncated: false },
    pageErrors: { messages: [], truncated: false },
    networkSummary: {
      requests: 1,
      failedRequests: 0,
      pendingRequests: 0,
      statusCodes: { "200": 1 },
    },
    traceReference: {
      path: "artifacts/trace-001.zip",
      digest: digest("c"),
      format: "playwright-trace" as const,
    },
    popupTopology: {
      pages: [
        {
          id: "page-1",
          kind: "page" as const,
          title: "Settings",
          url: "https://example.test/settings",
          active: true,
          closed: false,
        },
      ],
      activePageId: "page-1",
    },
    completeness: {
      status: "complete" as const,
      required: [...BROWSER_PROOF_REQUIRED_CHANNELS],
      captured: [...BROWSER_PROOF_REQUIRED_CHANNELS],
      missing: [],
    },
  };
}

test("browser proof evidence is versioned and exposes every required channel", () => {
  const parsed = parseBrowserProofEvidence(evidence());
  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(parsed.completeness.required, BROWSER_PROOF_REQUIRED_CHANNELS);
  assert.deepEqual(parsed.completeness.missing, []);
  assert.equal(parsed.browser.engine, parsed.environment.engine);
  assert.equal(parsed.browser.version, parsed.environment.revision);
  assert.equal(browserProofEvidenceArtifact(parsed, 42).kind, "browser-proof-evidence");
});

test("browser proof evidence rejects a complete claim with a missing channel", () => {
  const value = evidence();
  value.channels.network = { ...value.channels.network, status: "partial" };
  value.completeness = {
    ...value.completeness,
    captured: value.completeness.captured.filter((channel) => channel !== "network"),
    missing: ["network"],
  };
  value.completeness.status = "complete";
  assert.throws(() => browserProofEvidenceSchema.parse(value), /complete browser evidence/u);
});

test("browser proof evidence keeps page errors and failed requests explicit", () => {
  const value = evidence();
  value.pageErrors = { messages: ["TypeError: render failed"], truncated: false };
  value.networkSummary = {
    requests: 3,
    failedRequests: 1,
    pendingRequests: 0,
    statusCodes: { "200": 2, "500": 1 },
  };
  const parsed = parseBrowserProofEvidence(value);
  assert.deepEqual(parsed.pageErrors?.messages, ["TypeError: render failed"]);
  assert.equal(parsed.networkSummary?.failedRequests, 1);
});

test("browser proof evidence cannot attach a payload to an uncaptured channel", () => {
  const value = evidence();
  value.channels.network = { ...value.channels.network, status: "partial" };
  value.completeness = {
    status: "partial",
    required: [...BROWSER_PROOF_REQUIRED_CHANNELS],
    captured: value.completeness.captured.filter((channel) => channel !== "network"),
    missing: ["network"],
  };
  assert.throws(() => browserProofEvidenceSchema.parse(value), /must be omitted unless network/u);
});
