import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeTracePack, exportTracePack, verifyTracePack } from "./trace-pack.js";
import type { PersistedRun } from "./runs.js";

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
  assert.equal(JSON.stringify(first).includes("/this/local/path"), false);
  assert.deepEqual(verifyTracePack(first), first);

  const tampered = structuredClone(first);
  const run = tampered.objects.find((object) => object.kind === "frozen-run")!;
  (run.content as { status: string }).status = "error";
  assert.throws(() => verifyTracePack(tampered), /object integrity/u);
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
      "frame:../outside.png:invalid-path",
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
