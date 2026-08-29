import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BROWSER_PROOF_REQUIRED_CHANNELS,
  browserProofEvidenceArtifact,
  type BrowserProofEvidence,
  type TargetCapability,
} from "@relay/protocol";
import { inspectBrowserProofEvidence } from "./browser-proof-evidence.js";
import type { PersistedRun } from "./runs.js";
import { analyzeTracePack, exportTracePack, verifyTracePack } from "./trace-pack.js";

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

function browserEvidence(): BrowserProofEvidence {
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

async function persistedBrowserRun(dir: string): Promise<PersistedRun> {
  await mkdir(join(dir, "frames"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "video"), { recursive: true });
  await writeFile(join(dir, "frames", "001.png"), Buffer.from("png-fixture"));
  await writeFile(join(dir, "video", "run.mp4"), Buffer.from("video-fixture"));
  for (const path of [
    "aria-001.json",
    "console-001.json",
    "page-errors-001.json",
    "network-001.json",
    "trace-001.zip",
    "popups-001.json",
  ]) {
    await writeFile(join(dir, "artifacts", path), Buffer.from(path));
  }
  const environment = profile();
  const targetProfile = {
    id: "browser-profile-1",
    targetId: "browser-1",
    source: "browser" as const,
    platform: "browser" as const,
    name: "Browser fixture",
    viewport: environment.viewport,
    browserCaseProfile: environment,
    capabilities: ["snapshot", "screenshot"] as TargetCapability[],
    observedAt: 1,
  };
  const executionTarget = {
    schemaVersion: 1 as const,
    kind: "local-browser" as const,
    provider: { key: "relay.local.browser" as const, scope: "local" as const },
    targetId: "browser-1",
    platform: "browser" as const,
    identity: { kind: "browser-target" as const, value: "browser-1" },
  };
  const run: PersistedRun = {
    schemaVersion: 5,
    id: "run-browser-1",
    projectId: "project-1",
    action: "app-map:settings:language",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 3,
    serial: "browser-1",
    platform: "browser",
    executionTarget,
    targetProfile,
    browserCaseProfile: environment,
    sourceRevision: { vcs: "git", sha: "a".repeat(40), artifactDigest: digest("b") },
    logs: [],
    steps: [],
    frames: [
      {
        path: "frames/001.png",
        caption: "Settings",
        capturedAt: 2,
        bytes: Buffer.byteLength("png-fixture"),
        mime: "image/png",
      },
    ],
    dir,
    writtenAt: 4,
    artifacts: [],
    inputDigest: "d".repeat(64),
    resolvedInputs: {},
    evidence: {
      schemaVersion: 1,
      runId: "run-browser-1",
      target: {
        kind: "browser",
        platform: "browser",
        id: "browser-1",
        profileId: targetProfile.id,
      },
      startedAt: 2,
      finishedAt: 3,
      channels: Object.fromEntries(
        [
          "input",
          "screenshot",
          "video",
          "ui-tree",
          "logs",
          "network",
          "performance",
          "crash",
          "audio",
        ].map((channel) => [
          channel,
          {
            channel,
            status: "captured",
            entries: 1,
            bytes: 1,
            dropped: 0,
            redactions: 0,
          },
        ]),
      ),
      events: [],
    } as never,
  };
  run.artifacts.push({
    kind: "video",
    capturedAt: 3,
    data: { files: [{ path: "video/run.mp4", bytes: Buffer.byteLength("video-fixture") }] },
  });
  run.artifacts.push(browserProofEvidenceArtifact(browserEvidence(), 3));
  return run;
}

test("complete browser evidence is bound into a portable TracePack", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-browser-evidence-"));
  try {
    const run = await persistedBrowserRun(dir);
    const inspection = inspectBrowserProofEvidence(run);
    assert.deepEqual(inspection.missing, []);
    assert.equal(inspection.evidence?.networkSummary?.failedRequests, 0);

    const pack = await exportTracePack(run);
    assert.equal(pack.completeness.status, "complete", JSON.stringify(pack.completeness.missing));
    assert.deepEqual(pack.completeness.missing, []);
    assert.equal(pack.browserEvidence?.schemaVersion, 1);
    assert.deepEqual(verifyTracePack(pack), pack);
    assert.equal(analyzeTracePack(pack).historicalVerdict, "insufficient-evidence");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing browser evidence is partial and cannot masquerade as offline proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-browser-evidence-missing-"));
  try {
    const run = await persistedBrowserRun(dir);
    run.artifacts = [];
    const pack = await exportTracePack(run);
    assert.equal(pack.completeness.status, "partial");
    assert.ok(pack.completeness.missing.includes("browser-evidence:missing"));
    assert.equal(pack.browserEvidence, undefined);
    assert.ok(analyzeTracePack(pack).unknown.some(({ code }) => code === "MISSING_EVIDENCE"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser evidence from another Run or build fails its immutable binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-browser-evidence-binding-"));
  try {
    const run = await persistedBrowserRun(dir);
    const artifact = run.artifacts.find(({ kind }) => kind === "browser-proof-evidence")!;
    artifact.data = { ...(artifact.data as object), runId: "another-run" };
    assert.ok(inspectBrowserProofEvidence(run).missing.includes("browser-evidence:run-binding"));
    const pack = await exportTracePack(run);
    assert.ok(pack.completeness.missing.includes("browser-evidence:run-binding"));
    assert.equal(pack.browserEvidence, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a captured browser channel with a nonexistent artifact is incomplete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-browser-evidence-reference-"));
  try {
    const run = await persistedBrowserRun(dir);
    const artifact = run.artifacts.find(({ kind }) => kind === "browser-proof-evidence")!;
    const data = artifact.data as BrowserProofEvidence;
    data.channels.network = {
      ...data.channels.network,
      artifactRefs: ["artifacts/does-not-exist.json"],
    };
    const pack = await exportTracePack(run);
    assert.ok(
      pack.completeness.missing.includes(
        "browser-evidence:artifact-missing:artifacts/does-not-exist.json",
      ),
    );
    assert.equal(pack.browserEvidence, undefined);
    assert.equal(pack.completeness.status, "partial");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
