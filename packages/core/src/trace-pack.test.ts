import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileBrowserEnvironment, type BrowserProofEvidence } from "@relay/protocol";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { analyzeTracePack, exportTracePack, verifyTracePack } from "./trace-pack.js";
import type { PersistedRun } from "./runs.js";
import { writeAuthoringSession } from "./authoring-session-storage.js";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function digestManifest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function persistedRun(): PersistedRun {
  return {
    schemaVersion: 5,
    id: "run-trace-1",
    action: "app-map:map-1:test-1",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 3,
    logs: [],
    steps: [],
    frames: [],
    dir: "/this/local/path/must/not/be/exported",
    writtenAt: 4,
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: 1,
        data: {
          schemaVersion: 1,
          appMapId: "map-1",
          appMapRevision: 2,
          test: { id: "test-1", name: "Settings" },
          recipes: {},
        },
      },
      {
        kind: "navigation-proof-cursor",
        capturedAt: 2,
        data: { status: "proven", screenId: "settings", source: "capture" },
      },
      {
        kind: "campaign-transition-proof",
        capturedAt: 3,
        data: { checkId: "open-language", status: "verified" },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 4,
        data: {
          id: "open-language",
          title: "Open Language",
          status: "passed",
          warmSourceScreenId: "settings",
        },
      },
    ],
    inputDigest: "b".repeat(64),
    resolvedInputs: {},
    evidence: {
      schemaVersion: 1,
      runId: "run-trace-1",
      target: { kind: "device", platform: "android" },
      startedAt: 2,
      finishedAt: 3,
      channels: {},
      events: [],
    } as unknown as PersistedRun["evidence"],
  };
}

test("TracePack export is deterministic, portable, and verifies every content address", async () => {
  const first = await exportTracePack(persistedRun());
  const second = await exportTracePack(structuredClone(persistedRun()));

  assert.deepEqual(second, first);
  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.completeness.status, "complete");
  assert.equal(first.redaction.status, "applied-at-persistence");
  assert.deepEqual(first.completeness.artifacts, []);
  assert.equal(JSON.stringify(first).includes("/this/local/path"), false);
  assert.deepEqual(verifyTracePack(first), first);

  const tampered = structuredClone(first);
  const run = tampered.objects.find((object) => object.kind === "frozen-run")!;
  (run.content as { status: string }).status = "error";
  assert.throws(() => verifyTracePack(tampered), /object integrity/u);
});

test("unsupported and consent-denied collectors remain explicit without making the pack partial", async () => {
  const run = persistedRun();
  run.evidence!.channels = {
    input: {
      channel: "input",
      status: "captured",
      entries: 1,
      bytes: 0,
      dropped: 0,
      redactions: 0,
    },
    video: {
      channel: "video",
      status: "unsupported",
      entries: 0,
      bytes: 0,
      dropped: 0,
      redactions: 0,
      message: "the target does not expose video",
    },
    crash: {
      channel: "crash",
      status: "denied",
      entries: 0,
      bytes: 0,
      dropped: 0,
      redactions: 0,
      message: "requires explicit consent",
    },
    audio: {
      channel: "audio",
      status: "denied",
      entries: 0,
      bytes: 0,
      dropped: 0,
      redactions: 0,
      message: "requires explicit consent",
    },
  } as NonNullable<PersistedRun["evidence"]>["channels"];

  const pack = await exportTracePack(run);

  assert.equal(pack.completeness.status, "complete");
  assert.deepEqual(pack.completeness.missing, []);
  assert.deepEqual(pack.completeness.channels, {
    audio: "denied",
    crash: "denied",
    input: "captured",
    video: "unsupported",
  });
});

test("TracePack manifest retains typed managed-emulator packet collector failure", async () => {
  const run = persistedRun();
  run.artifacts.push({
    kind: "network",
    capturedAt: 3,
    data: {
      entries: [{ method: "GET", url: "https://example.test/health", status: 200 }],
      androidPacketCapture: {
        schemaVersion: 1,
        status: "failed",
        source: { kind: "emulator-packet", backend: "android-emulator-console" },
        scope: "entire-emulator",
        startedAt: 2,
        finishedAt: 3,
        stage: "finalize",
        message: "Emulator packet capture could not be finalized",
      },
    },
  });
  run.evidence!.channels = {
    network: {
      channel: "network",
      status: "partial",
      entries: 1,
      bytes: 10,
      dropped: 0,
      redactions: 0,
      message: "Emulator packet capture could not be finalized",
    },
  } as NonNullable<PersistedRun["evidence"]>["channels"];

  const pack = await exportTracePack(run);

  assert.equal(pack.androidPacketCapture?.status, "failed");
  assert.equal(
    pack.androidPacketCapture?.status === "failed" ? pack.androidPacketCapture.stage : undefined,
    "finalize",
  );
  assert.equal(pack.completeness.status, "partial");
  assert.ok(pack.completeness.missing.includes("channel:network:partial"));
  assert.deepEqual(verifyTracePack(pack), pack);

  const contradicted = structuredClone(pack);
  if (contradicted.androidPacketCapture?.status === "failed") {
    contradicted.androidPacketCapture.stage = "start";
  }
  const { digest: _digest, ...body } = contradicted;
  contradicted.digest = digestManifest(body);
  assert.throws(() => verifyTracePack(contradicted), /does not match the frozen run/u);
});

test("TracePack retains recording capture provenance when the run links an Authoring Session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-authoring-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  try {
    await writeAuthoringSession({
      schemaVersion: 1,
      id: "authoring-watch-1",
      organizationId: "local",
      projectId: "project-1",
      actorId: "agent:test",
      actorKind: "agent",
      appMapId: "map-1",
      state: "reviewing",
      target: { kind: "device", platform: "android", targetId: "device-1" },
      captureProvenance: {
        schemaVersion: 1,
        mode: "watch-and-infer",
        origin: "observed-transition",
      },
      leaseId: "lease-1",
      expectedAppMapRevision: 1,
      createdAt: 1,
      updatedAt: 2,
    });
    const run = persistedRun();
    run.executionProvenance = {
      schemaVersion: 1,
      actorId: "agent:test",
      actorKind: "agent",
      organizationId: "local",
      projectId: "project-1",
      operationId: "authoring.session.replay",
      requestId: "request-1",
      issuedAt: 1,
      authoringSessionId: "authoring-watch-1",
    };

    const pack = await exportTracePack(run);
    assert.deepEqual(pack.source.authoringCapture, {
      schemaVersion: 1,
      mode: "watch-and-infer",
      origin: "observed-transition",
    });
    assert.equal(pack.source.authoringCaptureProof, "inferred-unproved");
    assert.deepEqual(verifyTracePack(pack), pack);
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(directory, { recursive: true, force: true });
  }
});

test("TracePack omits recording proof when the referenced Authoring Session crosses scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-authoring-scope-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  try {
    await writeAuthoringSession({
      schemaVersion: 1,
      id: "authoring-foreign-1",
      organizationId: "other-organization",
      projectId: "other-project",
      actorId: "agent:test",
      actorKind: "agent",
      appMapId: "map-1",
      state: "reviewing",
      target: { kind: "device", platform: "android", targetId: "device-1" },
      captureProvenance: {
        schemaVersion: 1,
        mode: "instrumented",
        origin: "app-instrumentation",
      },
      leaseId: "lease-1",
      expectedAppMapRevision: 1,
      createdAt: 1,
      updatedAt: 2,
    });
    const run = persistedRun();
    run.executionProvenance = {
      schemaVersion: 1,
      actorId: "agent:test",
      actorKind: "agent",
      organizationId: "local",
      projectId: "project-1",
      operationId: "authoring.session.replay",
      requestId: "request-1",
      issuedAt: 1,
      authoringSessionId: "authoring-foreign-1",
    };

    const pack = await exportTracePack(run);
    assert.equal(pack.source.authoringCapture, undefined);
    assert.equal(pack.source.authoringCaptureProof, undefined);
    assert.deepEqual(verifyTracePack(pack), pack);
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(directory, { recursive: true, force: true });
  }
});

test("captured video is embedded and independently digest-verified", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-video-"));
  try {
    await mkdir(join(directory, "video"));
    const video = Buffer.from("bounded video evidence");
    await writeFile(join(directory, "video", "run.mp4"), video);
    const run = persistedRun();
    run.dir = directory;
    run.artifacts.push({
      kind: "video",
      capturedAt: 3,
      data: { files: [{ path: "video/run.mp4", bytes: video.byteLength }] },
    });
    run.evidence!.channels = {
      video: {
        channel: "video",
        status: "captured",
        entries: 1,
        bytes: video.byteLength,
        dropped: 0,
        redactions: 0,
      },
    } as NonNullable<PersistedRun["evidence"]>["channels"];

    const pack = await exportTracePack(run);

    assert.equal(pack.completeness.status, "complete");
    assert.deepEqual(pack.completeness.artifacts, [
      {
        path: "video/run.mp4",
        status: "embedded",
        sources: ["run.artifacts[4].data.files[0].path"],
        channels: ["video"],
        expectedBytes: video.byteLength,
        objectPath: "files/video/run.mp4",
        digest: `sha256:${createHash("sha256").update(video).digest("hex")}`,
        bytes: video.byteLength,
        mediaType: "video/mp4",
      },
    ]);
    assert.equal(
      pack.objects.find((object) => object.path === "files/video/run.mp4")?.kind,
      "artifact",
    );
    assert.deepEqual(verifyTracePack(pack), pack);

    const alteredClosure = structuredClone(pack);
    alteredClosure.completeness.artifacts![0]!.digest = `sha256:${"0".repeat(64)}`;
    const { digest: _digest, ...body } = alteredClosure;
    alteredClosure.digest = digestManifest(body);
    assert.throws(() => verifyTracePack(alteredClosure), /artifact closure failed/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("captured video with absent or redacted bytes cannot produce a complete pack", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-video-missing-"));
  try {
    const run = persistedRun();
    run.dir = directory;
    run.evidence!.channels = {
      video: {
        channel: "video",
        status: "captured",
        entries: 1,
        bytes: 42,
        dropped: 0,
        redactions: 0,
      },
    } as NonNullable<PersistedRun["evidence"]>["channels"];

    const unreferenced = await exportTracePack(run);
    assert.equal(unreferenced.completeness.status, "partial");
    assert.deepEqual(unreferenced.completeness.missing, [
      "channel:video:artifact-reference-missing",
    ]);

    run.artifacts.push({
      kind: "video",
      capturedAt: 3,
      data: { files: [{ path: "video/run.mp4", bytes: 42 }] },
    });

    const missing = await exportTracePack(run);
    assert.equal(missing.completeness.status, "partial");
    assert.deepEqual(missing.completeness.artifacts, [
      {
        path: "video/run.mp4",
        status: "missing",
        sources: ["run.artifacts[4].data.files[0].path"],
        channels: ["video"],
        expectedBytes: 42,
        reason: "not-found",
      },
    ]);

    run.evidence!.channels.video!.status = "redacted";
    const redacted = await exportTracePack(run);
    assert.equal(redacted.completeness.status, "partial");
    assert.equal(redacted.completeness.artifacts![0]?.status, "redacted");
    assert.equal(redacted.completeness.artifacts![0]?.reason, "redacted-channel");
    assert.equal(
      redacted.objects.some((object) => object.path === "files/video/run.mp4"),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("TracePack export does not embed a legacy browser trace without frozen consent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-browser-trace-"));
  try {
    await mkdir(join(directory, "browser"));
    const secretTrace = Buffer.from("trace.zip contains Authorization: Bearer legacy-secret");
    await writeFile(join(directory, "browser", "trace.zip"), secretTrace);
    const environment = compileBrowserEnvironment({ viewport: { width: 800, height: 600 } });
    const channel = (status: "captured" | "partial") => ({
      status,
      entries: status === "captured" ? 1 : 0,
      bytes: status === "captured" ? secretTrace.byteLength : 0,
      dropped: 0,
      redactions: 0,
      artifactRefs: status === "captured" ? ["browser/trace.zip"] : [],
    });
    const evidence: BrowserProofEvidence = {
      schemaVersion: 1,
      runId: "legacy-browser-run",
      target: { targetId: "browser-target", targetProfileId: "browser-profile" },
      build: { sourceSha: "a".repeat(40), artifactDigest: `sha256:${"b".repeat(64)}` },
      browser: { engine: environment.engine, version: environment.revision ?? "browser" },
      environment,
      channels: {
        screenshot: channel("partial"),
        accessibility: channel("partial"),
        "console-errors": channel("partial"),
        "page-errors": channel("partial"),
        network: channel("partial"),
        trace: channel("captured"),
        "popup-topology": channel("partial"),
      },
      traceReference: {
        path: "browser/trace.zip",
        digest: `sha256:${createHash("sha256").update(secretTrace).digest("hex")}`,
        format: "playwright-trace",
      },
      completeness: {
        status: "partial",
        required: [
          "screenshot",
          "accessibility",
          "console-errors",
          "page-errors",
          "network",
          "trace",
          "popup-topology",
        ],
        captured: ["trace"],
        missing: [
          "screenshot",
          "accessibility",
          "console-errors",
          "page-errors",
          "network",
          "popup-topology",
        ],
      },
    };
    const run = {
      ...persistedRun(),
      id: "legacy-browser-run",
      serial: "browser-target",
      platform: "browser",
      targetProfile: {
        id: "browser-profile",
        targetId: "browser-target",
        source: "browser",
        platform: "browser",
        name: "Browser",
        viewport: environment.viewport,
        browserCaseProfile: environment,
        capabilities: ["screenshot"],
        observedAt: 1,
      },
      browserCaseProfile: environment,
      sourceRevision: {
        vcs: "git",
        sha: "a".repeat(40),
        artifactDigest: `sha256:${"b".repeat(64)}`,
      },
      dir: directory,
      artifacts: [{ kind: "browser-proof-evidence", capturedAt: 3, data: evidence }],
      evidence: {
        schemaVersion: 1,
        runId: "legacy-browser-run",
        target: { kind: "browser", platform: "browser", id: "browser-target" },
        startedAt: 2,
        finishedAt: 3,
        collectionPolicy: { schemaVersion: 1, sensitive: {} },
        channels: {},
        events: [],
      } as unknown as PersistedRun["evidence"],
    } as unknown as PersistedRun;

    const pack = await exportTracePack(run);
    assert.equal(pack.completeness.status, "partial");
    assert.equal(
      pack.completeness.artifacts?.some(
        ({ path, status, reason }) =>
          path === "browser/trace.zip" && status === "redacted" && reason === "redacted-channel",
      ),
      true,
    );
    assert.equal(
      pack.objects.some((object) => object.path === "files/browser/trace.zip"),
      false,
    );
    assert.doesNotMatch(JSON.stringify(pack), /legacy-secret/u);
    assert.deepEqual(verifyTracePack(pack), pack);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("TracePack never embeds PCAP referenced outside the network channel without raw consent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-pcap-consent-"));
  try {
    await mkdir(join(directory, "network"));
    const packetBytes = Buffer.from("private packet bytes");
    await writeFile(join(directory, "network", "capture.pcap"), packetBytes);
    const run = persistedRun();
    run.dir = directory;
    run.result = { diagnostic: { path: "network/capture.pcap", bytes: packetBytes.byteLength } };
    run.evidence!.collectionPolicy = { schemaVersion: 1, sensitive: {} };

    const pack = await exportTracePack(run);
    const reference = pack.completeness.artifacts?.find(
      ({ path }) => path === "network/capture.pcap",
    );
    assert.equal(reference?.status, "redacted");
    assert.equal(reference?.reason, "redacted-channel");
    assert.equal(
      pack.objects.some(({ path }) => path === "files/network/capture.pcap"),
      false,
    );
    assert.doesNotMatch(JSON.stringify(pack), /private packet bytes/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("TracePack gates typed raw network provenance independent of extension and channel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-typed-raw-consent-"));
  try {
    await mkdir(join(directory, "network"));
    const rawBytes = Buffer.from("private packet bytes");
    await writeFile(join(directory, "network", "capture.raw"), rawBytes);
    const run = persistedRun();
    run.dir = directory;
    run.result = {
      // Deliberately unchanneled and extensionless: the typed rawCapture
      // marker, rather than the path or channel, carries the privacy meaning.
      androidNetwork: {
        rawCapture: {
          status: "captured",
          artifact: { path: "network/capture.raw", bytes: rawBytes.byteLength },
          bytes: rawBytes.byteLength,
        },
      },
    };
    run.evidence!.collectionPolicy = { schemaVersion: 1, sensitive: {} };

    const redacted = await exportTracePack(run);
    const redactedReference = redacted.completeness.artifacts?.find(
      ({ path }) => path === "network/capture.raw",
    );
    assert.equal(redactedReference?.status, "redacted");
    assert.equal(redactedReference?.reason, "redacted-channel");
    assert.equal(
      redacted.objects.some(({ path }) => path === "files/network/capture.raw"),
      false,
    );

    run.evidence!.collectionPolicy = {
      schemaVersion: 1,
      sensitive: {
        "network-raw": { grantedAt: 1, grantedBy: "human:test", reason: "fixture" },
      },
    };
    const retained = await exportTracePack(run);
    const retainedReference = retained.completeness.artifacts?.find(
      ({ path }) => path === "network/capture.raw",
    );
    assert.equal(retainedReference?.status, "embedded");
    assert.equal(
      retained.objects.some(({ path }) => path === "files/network/capture.raw"),
      true,
    );

    run.evidence!.collectionPolicy = {
      schemaVersion: 1,
      // A truthy but malformed persisted grant must not widen raw retention.
      sensitive: { "network-raw": {} },
    } as unknown as NonNullable<PersistedRun["evidence"]>["collectionPolicy"];
    const malformedGrant = await exportTracePack(run);
    assert.equal(
      malformedGrant.completeness.artifacts?.find(({ path }) => path === "network/capture.raw")
        ?.status,
      "redacted",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("artifact closure is bounded without silently dropping references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-limits-"));
  try {
    await mkdir(join(directory, "video"));
    await writeFile(join(directory, "video", "one.mp4"), "12345");
    await writeFile(join(directory, "video", "two.mp4"), "67890");
    const run = persistedRun();
    run.dir = directory;
    run.artifacts.push({
      kind: "video",
      capturedAt: 3,
      data: {
        files: [
          { path: "video/one.mp4", bytes: 5 },
          { path: "video/two.mp4", bytes: 5 },
        ],
      },
    });

    const objectBound = await exportTracePack(run, { maxArtifactBytes: 4 });
    assert.equal(objectBound.completeness.status, "partial");
    assert.deepEqual(
      objectBound.completeness.artifacts?.map(({ path, status, reason }) => ({
        path,
        status,
        reason,
      })),
      [
        { path: "video/one.mp4", status: "missing", reason: "object-too-large" },
        { path: "video/two.mp4", status: "missing", reason: "object-too-large" },
      ],
    );

    const aggregateBound = await exportTracePack(run, { maxTotalArtifactBytes: 5 });
    assert.deepEqual(
      aggregateBound.completeness.artifacts?.map(({ path, status, reason }) => ({
        path,
        status,
        reason,
      })),
      [
        { path: "video/one.mp4", status: "embedded", reason: undefined },
        { path: "video/two.mp4", status: "missing", reason: "pack-too-large" },
      ],
    );
    assert.throws(
      () => verifyTracePack(aggregateBound, { maxArtifactBytes: 4 }),
      /artifact object exceeds byte limit/u,
    );
    await assert.rejects(exportTracePack(run, { maxArtifacts: 1 }), /reference limit exceeded/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pre-closure schema-v1 TracePacks remain verifiable", async () => {
  const current = await exportTracePack(persistedRun());
  const legacy = structuredClone(current);
  delete legacy.completeness.artifacts;
  const { digest: _digest, ...body } = legacy;
  legacy.digest = digestManifest(body);

  assert.deepEqual(verifyTracePack(legacy), legacy);
});

test("external evidence references remain explicit when bytes cannot be resolved", async () => {
  const run = persistedRun();
  const digest = "a".repeat(64);
  run.artifacts.push({
    kind: "selector-evidence",
    capturedAt: 4,
    data: { observation: { uri: `relay-evidence://${digest}` } },
  });

  const pack = await exportTracePack(run);

  assert.equal(pack.completeness.status, "partial");
  assert.deepEqual(pack.completeness.artifacts, [
    {
      path: `relay-evidence://${digest}`,
      status: "missing",
      sources: ["run.artifacts[4].data.observation.uri"],
      channels: [],
      reason: "external-reference-unresolved",
    },
  ]);
  assert.deepEqual(verifyTracePack(pack), pack);
});

test("content-addressed Relay evidence is embedded into the portable TracePack", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "relay-trace-pack-evidence-"));
  const previousStateDirectory = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = stateDirectory;
  try {
    const tree = await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt: 4,
      data: JSON.stringify({ role: "application", name: "Settings" }),
      mime: "application/json",
    });
    const run = persistedRun();
    run.artifacts.push({
      kind: "selector-evidence",
      capturedAt: 4,
      data: { observation: tree },
    });

    const pack = await exportTracePack(run);

    assert.equal(pack.completeness.status, "complete");
    assert.deepEqual(pack.completeness.missing, []);
    assert.deepEqual(pack.completeness.artifacts, [
      {
        path: `evidence/${tree.sha256}`,
        status: "embedded",
        sources: ["run.artifacts[4].data.observation.uri"],
        channels: [],
        expectedBytes: tree.bytes,
        objectPath: `files/evidence/${tree.sha256}`,
        digest: `sha256:${tree.sha256}`,
        bytes: tree.bytes,
        mediaType: "application/json",
      },
    ]);
    assert.deepEqual(verifyTracePack(pack), pack);
  } finally {
    if (previousStateDirectory === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDirectory;
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("offline analysis names historical proof but keeps future behavior unknown", async () => {
  const analysis = analyzeTracePack(await exportTracePack(persistedRun()));

  assert.equal(analysis.historicalVerdict, "proved");
  assert.equal(analysis.futureTransitionVerdict, "unknown");
  assert.equal(
    analysis.proved.some((proof) => proof.code === "RECORDED_TRANSITION_PROOF"),
    true,
  );
  assert.equal(
    analysis.unknown.some((item) => item.code === "FUTURE_TARGET_STATE"),
    true,
  );
  assert.deepEqual(analysis.smallestLiveVerification, {
    kind: "replay-frozen-test",
    reason:
      "Historical evidence is exhausted; a live replay is the smallest way to learn whether current behavior still agrees.",
    requiresTarget: true,
  });
});

test("offline analysis recomputes selector robustness without upgrading future proof", async () => {
  const run = persistedRun();
  const plan = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan")!;
  plan.data = {
    ...(plan.data as Record<string, unknown>),
    recipes: {
      root: {
        steps: [
          {
            kind: "module",
            recipeId: "open-language",
            check: { id: "open-language", title: "Open Language" },
          },
        ],
      },
      "open-language": {
        steps: [{ kind: "tap", id: "tap-language", target: { label: "Language" } }],
      },
    },
  };
  run.artifacts.push({
    kind: "campaign-check-evidence",
    capturedAt: 3,
    data: {
      checkId: "open-language",
      attempts: [{ kind: "selector", data: { status: "resolved", strategy: "label" } }],
      nodes: [
        {
          role: "button",
          label: "Language",
          hittable: true,
          rect: { x: 10, y: 20, width: 100, height: 40 },
        },
      ],
    },
  });

  const analysis = analyzeTracePack(await exportTracePack(run));

  assert.deepEqual(analysis.recomputed, [
    {
      code: "CURRENT_SELECTOR_MATCHER",
      algorithm: "semantic-activation-v1",
      checkId: "open-language",
      status: "supports-recorded",
      robustness: 1,
      statement:
        "The current pure matcher resolves 1/1 frozen semantic selectors for Open Language.",
      evidence: analysis.recomputed?.[0]?.evidence,
      requiresLiveVerification: true,
    },
  ]);
  assert.equal(analysis.futureTransitionVerdict, "unknown");
  assert.match(analysis.recomputed?.[0]?.evidence[0] ?? "", /^sha256:[a-f0-9]{64}$/u);
});

test("offline analysis isolates the first failed check as the smallest live experiment", async () => {
  const run = persistedRun();
  run.status = "error";
  run.artifacts = run.artifacts.filter((artifact) => artifact.kind !== "campaign-transition-proof");
  const result = run.artifacts.find((artifact) => artifact.kind === "campaign-check-result")!;
  result.data = { ...(result.data as object), status: "failed", error: "tap had no effect" };

  const analysis = analyzeTracePack(await exportTracePack(run));

  assert.equal(analysis.historicalVerdict, "failed");
  assert.equal(analysis.futureTransitionVerdict, "unknown");
  assert.deepEqual(analysis.smallestLiveVerification, {
    kind: "replay-check",
    checkId: "open-language",
    reason: "Open Language is the first causal failure; replay only this check first.",
    requiresTarget: true,
  });
});

test("degraded channels and invalid frame paths make completeness explicitly partial", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-pack-"));
  try {
    await mkdir(join(directory, "frames"));
    await writeFile(join(directory, "frames", "001.png"), "one-frame");
    const run = persistedRun();
    run.dir = directory;
    run.frames = [
      { path: "frames/001.png", caption: "screen", capturedAt: 1 },
      { path: "frames/./001.png", caption: "same screen", capturedAt: 1 },
      { path: "../outside.png", caption: "invalid", capturedAt: 1 },
    ];
    run.evidence!.channels = {
      screenshot: {
        channel: "screenshot",
        status: "partial",
        entries: 1,
        bytes: 9,
        dropped: 1,
        redactions: 0,
      },
    } as NonNullable<PersistedRun["evidence"]>["channels"];

    const pack = await exportTracePack(run);

    assert.equal(pack.completeness.status, "partial");
    assert.deepEqual(pack.completeness.missing, [
      "artifact:../outside.png:missing:invalid-path",
      "channel:screenshot:partial",
    ]);
    assert.deepEqual(
      pack.objects.filter((object) => object.kind === "frame").map((object) => object.path),
      ["files/frames/001.png"],
    );
    const analysis = analyzeTracePack(pack);
    assert.equal(analysis.historicalVerdict, "proved");
    assert.equal(
      analysis.unknown.some((item) => item.code === "MISSING_EVIDENCE"),
      true,
    );

    const duplicate = {
      ...structuredClone(pack),
      objects: [...pack.objects, structuredClone(pack.objects[0]!)],
    };
    assert.throws(() => verifyTracePack(duplicate), /path is duplicated/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
