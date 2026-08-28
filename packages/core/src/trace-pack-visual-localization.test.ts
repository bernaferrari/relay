import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { FRAME_OBSERVATION_KIND, type FrameObservation } from "./frame-observation.js";
import type { PersistedRun } from "./runs.js";
import { exportTracePack } from "./trace-pack.js";
import { recomputeTracePackVisualLocalization } from "./trace-pack-visual-localization.js";

function png(width: number, height: number, red: number): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = red;
    image.data[offset + 1] = 20;
    image.data[offset + 2] = 40;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

function observation(framePath: string, label: string): FrameObservation {
  return {
    schemaVersion: 1,
    framePath,
    caption: "Data Controls",
    fingerprint: `fingerprint:${label}`,
    title: "Data Controls",
    controls: [
      {
        id: "title",
        stableKey: "identifier:data-controls-title",
        label,
        role: "text",
        target: { identifier: "data-controls-title", label },
        rect: { x: 20, y: 40, width: 140, height: 30 },
      },
    ],
  };
}

async function runFixture(input: {
  id: string;
  locale: string;
  sha?: string;
  bytes?: Buffer;
  semanticLabel?: string;
  missingFrame?: boolean;
}): Promise<{ run: PersistedRun; remove: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "relay-trace-visual-"));
  const framePath = "frames/001.png";
  const bytes = input.bytes ?? png(2, 2, 10);
  if (!input.missingFrame) {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(directory, "frames")));
    await writeFile(join(directory, framePath), bytes);
  }
  const artifacts: PersistedRun["artifacts"] = [
    {
      kind: "app-map-test-plan",
      capturedAt: 1,
      data: {
        schemaVersion: 1,
        appMapId: "settings",
        appMapRevision: 1,
        test: { id: "data-controls", name: "Data Controls" },
        recipes: {},
      },
    },
    {
      kind: "frozen-inputs",
      capturedAt: 1,
      data: { values: { language: input.locale }, expectedScreenshots: 1 },
    },
    ...(input.semanticLabel
      ? [
          {
            kind: FRAME_OBSERVATION_KIND,
            capturedAt: 2,
            data: observation(framePath, input.semanticLabel),
          },
        ]
      : []),
  ];
  return {
    run: {
      schemaVersion: 5,
      id: input.id,
      action: "app-map:settings:test:data-controls",
      serial: "pixel-1",
      platform: "android",
      status: "ok",
      attempts: 1,
      queuedAt: 1,
      startedAt: 2,
      finishedAt: 3,
      logs: [],
      steps: [],
      frames: [
        {
          path: framePath,
          caption: "Data Controls",
          capturedAt: 2,
          bytes: bytes.byteLength,
          mime: "image/png",
        },
      ],
      dir: directory,
      writtenAt: 4,
      artifacts,
      inputDigest: "a".repeat(64),
      resolvedInputs: { language: input.locale },
      sourceRevision: { vcs: "git", sha: input.sha ?? "1234567" },
      evidence: {
        schemaVersion: 1,
        runId: input.id,
        target: { kind: "device", platform: "android", id: "pixel-1" },
        startedAt: 2,
        finishedAt: 3,
        channels: {
          screenshot: {
            channel: "screenshot",
            status: "captured",
            entries: 1,
            bytes: bytes.byteLength,
            dropped: 0,
            redactions: 0,
          },
        } as PersistedRun["evidence"] extends { channels: infer T } ? T : never,
        events: [],
      },
    },
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

test("recomputes locale-specific frame count, dimensions, and exact content without calling change a regression", async () => {
  const first = await runFixture({ id: "visual-one", locale: "pt-BR", bytes: png(2, 2, 10) });
  const latest = await runFixture({
    id: "visual-two",
    locale: "pt-BR",
    sha: "7654321",
    bytes: png(3, 2, 30),
  });
  try {
    const result = recomputeTracePackVisualLocalization([
      await exportTracePack(first.run),
      await exportTracePack(latest.run),
    ]);

    assert.equal(result.historicalBaseline.status, "comparable");
    assert.equal(result.historicalBaseline.locale, "pt-BR");
    assert.equal(result.historicalBaseline.frames[0]?.status, "dimensions-changed");
    assert.equal(result.historicalBaseline.frames[0]?.fact.classification, "recomputable");
    assert.equal(result.localization.status, "not-applicable");
    assert.equal(result.futureTransitionVerdict, "unknown");
    assert.deepEqual(result.repairPolicy, { mutation: "none", requiresReview: true });
  } finally {
    await Promise.all([first.remove(), latest.remove()]);
  }
});

test("separates byte-identical evidence from changed pixels without inferring visual quality", async () => {
  const bytes = png(2, 2, 10);
  const first = await runFixture({ id: "pixels-one", locale: "de", bytes });
  const matching = await runFixture({
    id: "pixels-two",
    locale: "de",
    sha: "7654321",
    bytes,
  });
  const changed = await runFixture({
    id: "pixels-three",
    locale: "de",
    sha: "abcdef0",
    bytes: png(2, 2, 90),
  });
  try {
    const exact = recomputeTracePackVisualLocalization([
      await exportTracePack(first.run),
      await exportTracePack(matching.run),
    ]);
    assert.equal(exact.historicalBaseline.frames[0]?.status, "exact-match");

    const delta = recomputeTracePackVisualLocalization([
      await exportTracePack(matching.run),
      await exportTracePack(changed.run),
    ]);
    assert.equal(delta.historicalBaseline.frames[0]?.status, "pixels-changed");
    assert.match(delta.historicalBaseline.frames[0]?.fact.statement ?? "", /not regression/u);
  } finally {
    await Promise.all([first.remove(), matching.remove(), changed.remove()]);
  }
});

test("reruns existing deterministic localization findings from embedded frame observations", async () => {
  const english = await runFixture({
    id: "locale-en",
    locale: "en",
    bytes: png(2, 2, 10),
    semanticLabel: "Data Controls",
  });
  const portuguese = await runFixture({
    id: "locale-pt",
    locale: "pt-BR",
    bytes: png(2, 2, 30),
    semanticLabel: "Data Controls",
  });
  try {
    const result = recomputeTracePackVisualLocalization([
      await exportTracePack(english.run),
      await exportTracePack(portuguese.run),
    ]);

    assert.equal(result.historicalBaseline.status, "not-comparable");
    assert.equal(result.localization.status, "recomputed");
    assert.equal(result.localization.baselineLocale, "en");
    assert.equal(result.localization.coverage.inspectedFrames, 2);
    assert.equal(result.localization.findings[0]?.code, "POSSIBLE_LOCALE_NOT_APPLIED");
    assert.equal(result.localization.findings[0]?.locale, "pt-BR");
    assert.equal(result.sufficiency.localization, "sufficient");
    assert.equal(result.smallestLiveVerification.kind, "replay-frozen-test");
  } finally {
    await Promise.all([english.remove(), portuguese.remove()]);
  }
});

test("fails closed when an expected frame is absent from the artifact closure", async () => {
  const first = await runFixture({ id: "missing-one", locale: "en" });
  const missing = await runFixture({ id: "missing-two", locale: "en", missingFrame: true });
  try {
    const result = recomputeTracePackVisualLocalization([
      await exportTracePack(first.run),
      await exportTracePack(missing.run),
    ]);

    assert.equal(result.sufficiency.visual, "insufficient");
    assert.equal(result.historicalBaseline.frames[0]?.status, "presence-changed");
    assert.equal(result.historicalBaseline.frames[0]?.fact.classification, "unknowable");
    assert.equal(result.smallestLiveVerification.kind, "recapture-frame-evidence");
    assert.equal(result.futureTransitionVerdict, "unknown");
  } finally {
    await Promise.all([first.remove(), missing.remove()]);
  }
});

test("requests the smallest semantic recapture when locale pixels exist but a tree is absent", async () => {
  const english = await runFixture({
    id: "partial-en",
    locale: "en",
    semanticLabel: "Data Controls",
  });
  const german = await runFixture({ id: "partial-de", locale: "de", bytes: png(2, 2, 50) });
  try {
    const result = recomputeTracePackVisualLocalization([
      await exportTracePack(english.run),
      await exportTracePack(german.run),
    ]);

    assert.equal(result.localization.status, "partial");
    assert.equal(result.sufficiency.localization, "partial");
    assert.equal(result.smallestLiveVerification.kind, "recapture-semantic-evidence");
    assert.equal(result.futureTransitionVerdict, "unknown");
  } finally {
    await Promise.all([english.remove(), german.remove()]);
  }
});
