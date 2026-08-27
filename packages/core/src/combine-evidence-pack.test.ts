import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CombineEvidenceControl } from "@relay/protocol";
import { PNG } from "pngjs";
import { FRAME_OBSERVATION_KIND, type FrameObservation } from "./frame-observation.js";
import {
  analyzeCombineEvidenceBatch,
  analyzeCombineEvidenceJobs,
  exportCombineEvidencePack,
} from "./combine-evidence-pack.js";
import { composeScrollSurveyFrames } from "./scrollable-survey.js";
import type { ScrollSurveyFrame } from "./scrollable-survey-types.js";
import type { TestJob } from "./session-contract.js";

function row(stableKey: string, label: string): CombineEvidenceControl {
  return {
    id: `${stableKey}-1`,
    label,
    stableKey,
    target: { identifier: stableKey },
    rect: { x: 0, y: 0, width: 140, height: 44 },
  };
}

function localeCase(input: {
  locale: string;
  runDir: string;
  controls?: CombineEvidenceControl[];
}): TestJob {
  const observation: FrameObservation = {
    schemaVersion: 1,
    framePath: "frames/001.png",
    caption: "settings",
    fingerprint: `fingerprint-${input.locale}`,
    title: "Settings",
    controls: input.controls ?? [],
  };
  return {
    id: `job-${input.locale}`,
    action: "settings-smoke",
    title: `Settings · ${input.locale}`,
    status: "ok",
    batchId: "batch-1",
    runDir: input.runDir,
    resolvedInputs: { locale: input.locale },
    steps: [],
    frames: [],
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 1,
        data: { kind: "combine", locale: input.locale },
      },
      ...(input.controls
        ? [{ kind: FRAME_OBSERVATION_KIND, capturedAt: 2, data: observation }]
        : []),
    ],
  } as unknown as TestJob;
}

test("a batch is analyzed from its persisted runs once the registry has let go", async () => {
  // The job registry holds a hundred jobs and dies with the process, and a
  // forty-language sweep is neither short nor small. The failure that matters
  // is the quiet one: dropping the earliest cases takes the baseline locale
  // with them, and a pack with nothing to compare against reads as clean.
  const directory = await mkdtemp(join(tmpdir(), "relay-locale-disk-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  process.env.RELAY_RUNS_DIR = join(directory, "runs");
  try {
    for (const [index, locale] of ["en", "pt-BR"].entries()) {
      const runDir = join(
        directory,
        "runs",
        `2026-01-0${index + 1}_option-run-evicted_serial_${locale}`,
      );
      await mkdir(join(runDir, "frames"), { recursive: true });
      await writeFile(join(runDir, "frames", "001.png"), `raster-${locale}`);
      const job = localeCase({
        locale,
        runDir,
        controls: [row("settings.language", "App Language")],
      }) as TestJob & { schemaVersion: number };
      job.frames = [
        { path: "frames/001.png", caption: "settings", capturedAt: 2 },
      ] as TestJob["frames"];
      // Written as the run store writes it: an action naming the batch, and the
      // folder recorded as `dir` rather than as the `runDir` a live job holds.
      await writeFile(
        join(runDir, "run.json"),
        JSON.stringify({
          ...job,
          schemaVersion: 4,
          action: "option-run-evicted",
          runDir: undefined,
        }),
      );
    }

    const report = await analyzeCombineEvidenceBatch("evicted");

    assert.deepEqual(report.locales, ["en", "pt-BR"]);
    assert.deepEqual(report.coverage, { frames: 2, inspectedFrames: 2 });
    assert.equal(report.analysis.findings.at(0)?.code, "POSSIBLE_UNTRANSLATED_TEXT");
    assert.equal(report.analysis.findings.at(0)?.locale, "pt-BR");
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(directory, { recursive: true, force: true });
  }
});

test("an exported Combine pack carries findings beside the frames that produced them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-evidence-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  try {
    const jobs: TestJob[] = [];
    for (const [locale, label] of [
      ["en", "App Language"],
      ["pt-BR", "App Language"],
    ] as const) {
      const runDir = join(directory, "runs", locale);
      await mkdir(join(runDir, "frames"), { recursive: true });
      await writeFile(join(runDir, "frames", "001.png"), `raster-${locale}`);
      jobs.push(
        localeCase({
          locale,
          runDir,
          controls: [row("settings.language", label), row("settings.about", `About ${locale}`)],
        }),
      );
    }

    const pack = await exportCombineEvidencePack({
      batchId: "batch-1",
      jobs,
      recipeId: "settings",
    });

    const finding = pack.manifest.analysis.findings.at(0);
    assert.equal(finding?.code, "POSSIBLE_UNTRANSLATED_TEXT");
    assert.equal(finding?.locale, "pt-BR");
    assert.equal(pack.manifest.schemaVersion, 2);
    assert.deepEqual(pack.manifest.analysisCoverage, { frames: 2, inspectedFrames: 2 });
    assert.equal(
      pack.manifest.byCanonicalKey[finding!.canonicalKey]?.["pt-BR"],
      "pt-br/screenshots/001-001.png",
    );
    assert.deepEqual(pack.manifest.cases[1]?.captures, [
      {
        path: "pt-br/screenshots/001-001.png",
        canonicalKey: "frame-001",
        caption: "settings",
        inspected: true,
      },
    ]);

    const written = JSON.parse(
      await readFile(join(pack.rootDir, "manifest.json"), "utf8"),
    ) as typeof pack.manifest;
    assert.equal(written.analysis.findings.length, pack.manifest.analysis.findings.length);
    const html = await readFile(join(pack.rootDir, "index.html"), "utf8");
    assert.match(html, /POSSIBLE_UNTRANSLATED_TEXT/);
    assert.match(html, /1 finding \(0 critical\) against en/);
    const readme = await readFile(join(pack.rootDir, "README.md"), "utf8");
    assert.match(readme, /Frames read: 2 of 2/);
    await assert.rejects(
      readFile(join(pack.rootDir, "en", "accessibility", "001-001.json"), "utf8"),
    );
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a live batch reports the same findings without writing a pack", () => {
  const jobs = ["en", "pt-BR"].map((locale) => {
    const job = localeCase({
      locale,
      runDir: `/tmp/${locale}`,
      controls: [row("settings.language", "App Language")],
    });
    job.frames = [
      { path: "frames/000.png", caption: "before · launch", capturedAt: 1 },
      { path: "frames/001.png", caption: "screen: settings", capturedAt: 2 },
    ] as TestJob["frames"];
    return job;
  });

  const report = analyzeCombineEvidenceJobs("batch-live", jobs);

  assert.deepEqual(report.locales, ["en", "pt-BR"]);
  // The launch diagnostic is not an authored screenshot and must not become a
  // screen the other locales are compared against.
  assert.deepEqual(report.cases[1]?.frames, [
    {
      framePath: "frames/001.png",
      canonicalKey: "frame-001",
      caption: "settings",
      inspected: true,
    },
  ]);
  assert.deepEqual(report.coverage, { frames: 2, inspectedFrames: 2 });
  assert.equal(report.analysis.findings.at(0)?.code, "POSSIBLE_UNTRANSLATED_TEXT");
  assert.equal(report.analysis.findings.at(0)?.locale, "pt-BR");
});

test("the baseline restore case does not switch a matrix off text comparison", () => {
  // Every matrix ends by putting the device back on its default language, so
  // the baseline locale appears twice. The selector columns the matrix derives
  // from the locale differ between those two cases and are not state.
  const jobs = ["en", "pt-BR", "en"].map((locale, index) => {
    const job = localeCase({
      locale,
      runDir: `/tmp/restore-${index}`,
      controls: [row("settings.language", "App Language")],
    });
    job.id = `job-restore-${index}`;
    job.artifacts[0] = {
      kind: "frozen-inputs",
      capturedAt: 1,
      data: {
        kind: "combine",
        locale,
        values: { locale, locale_label: index === 2 ? locale : "-", locale_identifier: locale },
      },
    };
    job.frames = [
      { path: "frames/001.png", caption: "screen: settings", capturedAt: 2 },
    ] as TestJob["frames"];
    return job;
  });

  const report = analyzeCombineEvidenceJobs("batch-restore", jobs);

  assert.deepEqual(report.locales, ["en", "pt-BR"]);
  assert.equal(report.analysis.findings.at(0)?.code, "POSSIBLE_UNTRANSLATED_TEXT");
  assert.equal(report.analysis.findings.at(0)?.locale, "pt-BR");
});

test("a combine that varies state alongside language keeps its labels unread", () => {
  const jobs = [
    ["en", "kids-on"],
    ["en", "kids-off"],
    ["pt-BR", "kids-on"],
    ["pt-BR", "kids-off"],
  ].map(([locale, world], index) => {
    const job = localeCase({
      locale: `${world}-${locale}`,
      runDir: `/tmp/state-${index}`,
      controls: [row("settings.language", "App Language")],
    });
    job.id = `job-state-${index}`;
    job.resolvedInputs = {};
    job.artifacts[0] = {
      kind: "frozen-inputs",
      capturedAt: 1,
      data: { kind: "combine", world, values: { language: locale, kidsMode: world } },
    };
    job.frames = [
      { path: "frames/001.png", caption: "screen: settings", capturedAt: 2 },
    ] as TestJob["frames"];
    return job;
  });

  const report = analyzeCombineEvidenceJobs("batch-state", jobs);

  assert.deepEqual(report.analysis.findings, []);
});

test("a combine over a language variable is still compared as translations", () => {
  const jobs = ["en", "pt-BR"].map((locale) => {
    const job = localeCase({
      locale: `world-${locale}`,
      runDir: `/tmp/${locale}`,
      controls: [row("settings.language", "App Language")],
    });
    job.resolvedInputs = {};
    job.artifacts[0] = {
      kind: "frozen-inputs",
      capturedAt: 1,
      data: { kind: "combine", world: `world-${locale}`, values: { language: locale } },
    };
    job.frames = [
      { path: "frames/001.png", caption: "screen: settings", capturedAt: 2 },
    ] as TestJob["frames"];
    return job;
  });

  const report = analyzeCombineEvidenceJobs("batch-combine-language", jobs);

  assert.equal(report.analysis.findings.at(0)?.code, "POSSIBLE_UNTRANSLATED_TEXT");
});

test("export copies a raw tree next to each PNG and does not treat control lists as the tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-locale-tree-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  try {
    const runDir = join(directory, "runs", "en");
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "001.png"), "raster-en");
    await writeFile(
      join(runDir, "frames", "001.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "relay.frame-tree",
        nodes: [
          {
            identifier: "delete-account",
            label: "Delete Account",
            type: "Button",
            rect: { x: 0, y: 400, width: 140, height: 44 },
          },
        ],
      }),
    );
    const job = localeCase({
      locale: "en",
      runDir,
      controls: [row("settings.language", "App Language")],
    });
    const pack = await exportCombineEvidencePack({ batchId: "batch-tree", jobs: [job] });
    const png = join(pack.rootDir, "en", "screenshots", "001-001.png");
    const tree = JSON.parse(
      await readFile(join(pack.rootDir, "en", "accessibility", "001-001.json"), "utf8"),
    ) as { nodes: Array<{ identifier?: string }> };
    assert.equal(await readFile(png, "utf8"), "raster-en");
    assert.equal(tree.nodes[0]?.identifier, "delete-account");
    assert.equal(pack.manifest.cases[0]?.frames[0], "en/screenshots/001-001.png");
    assert.equal(pack.manifest.cases[0]?.captures?.[0]?.inspected, true);
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a combine pack keeps its frames without reading state changes as translations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-pack-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  try {
    const jobs: TestJob[] = [];
    for (const world of ["kids-on", "kids-off"]) {
      const runDir = join(directory, "runs", world);
      await mkdir(join(runDir, "frames"), { recursive: true });
      await writeFile(join(runDir, "frames", "001.png"), `raster-${world}`);
      const job = localeCase({ locale: world, runDir, controls: [row("row", "Language")] });
      job.artifacts[0] = {
        kind: "frozen-inputs",
        capturedAt: 1,
        data: { kind: "combine", world },
      };
      job.resolvedInputs = {};
      jobs.push(job);
    }

    const pack = await exportCombineEvidencePack({ batchId: "batch-2", jobs });

    assert.deepEqual(pack.manifest.analysis.findings, []);
    assert.deepEqual(pack.manifest.locales, ["kids-on", "kids-off"]);
    assert.equal(pack.manifest.cases[0]?.frames.length, 1);
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});

function destinationViewport(
  shiftY: number,
  capturedAt: number,
): {
  bytes: Buffer;
  nodes: Array<{
    identifier: string;
    label: string;
    type: string;
    rect: { x: number; y: number; width: number; height: number };
  }>;
  frame: ScrollSurveyFrame;
} {
  const width = 160;
  const height = 200;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const documentY = y + shiftY;
    const red = (documentY * 17) % 200;
    const green = (documentY * 9) % 180;
    const blue = 80 + (documentY % 40);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = 255;
    }
  }
  const bytes = PNG.sync.write(png);
  const rows = [
    { identifier: "row-export", label: "Export Data", y: 40 },
    { identifier: "row-delete", label: "Delete Account", y: 90 },
    { identifier: "row-language", label: "App Language", y: 140 },
    { identifier: "row-privacy", label: "Privacy", y: 220 },
    { identifier: "row-about", label: "About", y: 280 },
  ];
  const nodes = rows
    .map((row) => ({
      identifier: row.identifier,
      label: row.label,
      type: "TextView",
      rect: { x: 10, y: row.y - shiftY, width: 120, height: 24 },
    }))
    .filter((node) => node.rect.y > -24 && node.rect.y < height);
  return {
    bytes,
    nodes,
    frame: {
      index: capturedAt,
      offsetY: shiftY,
      appendedHeight: shiftY,
      screenshot: { base64: bytes.toString("base64"), width, height, capturedAt },
      snapshot: {
        capturedAt,
        nodes,
        interactive: [],
        inspectable: true,
        source: "sdk",
        bounds: { width, height },
        screenIdentity: { fingerprint: "f".repeat(64), nodes: [], volatileSignals: [] },
      },
    },
  };
}

test("a job with destination-survey frames exports the stitched long page beside numbered frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-full-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  try {
    const first = destinationViewport(0, 0);
    const second = destinationViewport(80, 1);
    const composition = composeScrollSurveyFrames([first.frame, second.frame]);
    assert.ok(composition?.stitched, "fixture viewports must compose into one long page");
    assert.ok(
      (composition.stitched?.height ?? 0) > first.frame.screenshot.height,
      "the stitch must be taller than one viewport",
    );

    const runDir = join(directory, "runs", "en");
    await mkdir(join(runDir, "frames"), { recursive: true });
    const job = localeCase({ locale: "en", runDir });
    job.frames = [];
    for (const [index, viewport] of [first, second].entries()) {
      const name = `${String(index + 1).padStart(3, "0")}.png`;
      await writeFile(join(runDir, "frames", name), viewport.bytes);
      await writeFile(
        join(runDir, "frames", name.replace(/\.png$/u, ".json")),
        JSON.stringify({
          schemaVersion: 1,
          kind: "relay.frame-tree",
          nodes: viewport.nodes,
        }),
      );
      job.frames.push({
        path: `frames/${name}`,
        caption: `destination:Settings · ${index + 1}`,
        capturedAt: index + 1,
      } as TestJob["frames"][number]);
    }

    const pack = await exportCombineEvidencePack({ batchId: "batch-full", jobs: [job] });
    const shots = (await readdir(join(pack.rootDir, "en", "screenshots"))).sort();
    assert.deepEqual(shots, ["001-001.png", "002-002.png", "full.png"]);
    const tree = JSON.parse(
      await readFile(join(pack.rootDir, "en", "accessibility", "full.json"), "utf8"),
    ) as { nodes: Array<{ label?: string }> };
    assert.ok(tree.nodes.some((node) => node.label === "Export Data"));
    assert.ok(tree.nodes.some((node) => node.label === "Privacy"));
    const stitched = PNG.sync.read(
      await readFile(join(pack.rootDir, "en", "screenshots", "full.png")),
    );
    assert.equal(stitched.height, composition.stitched?.height);
    assert.ok(pack.manifest.cases[0]?.frames.includes("en/screenshots/full.png"));
    const readme = await readFile(join(pack.rootDir, "README.md"), "utf8");
    assert.match(readme, /full\.png/);
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a combine pack does not invent full.png without a destination survey or stitch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-no-full-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  try {
    const runDir = join(directory, "runs", "en");
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "001.png"), "raster-en");
    const job = localeCase({
      locale: "en",
      runDir,
      controls: [row("settings.language", "App Language")],
    });
    const pack = await exportCombineEvidencePack({ batchId: "batch-no-full", jobs: [job] });
    assert.deepEqual(await readdir(join(pack.rootDir, "en", "screenshots")), ["001-001.png"]);
    await assert.rejects(readFile(join(pack.rootDir, "en", "screenshots", "full.png")));
    await assert.rejects(readFile(join(pack.rootDir, "en", "accessibility", "full.json")));
    assert.equal(pack.manifest.cases[0]?.frames.includes("en/screenshots/full.png"), false);
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a run that already holds a stitched full page ships it even without destination captions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-stitch-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  try {
    const runDir = join(directory, "runs", "en");
    await mkdir(join(runDir, "frames"), { recursive: true });
    await writeFile(join(runDir, "frames", "001.png"), "raster-en");
    await writeFile(join(runDir, "full.png"), "stitched-page");
    await writeFile(
      join(runDir, "full.json"),
      JSON.stringify({
        width: 10,
        height: 40,
        nodeCount: 1,
        snapshot: {
          nodes: [
            {
              identifier: "delete-account",
              label: "Delete Account",
              type: "Button",
              rect: { x: 0, y: 400, width: 140, height: 44 },
            },
          ],
        },
      }),
    );
    const job = localeCase({ locale: "en", runDir });
    const pack = await exportCombineEvidencePack({ batchId: "batch-stitch", jobs: [job] });
    assert.equal(
      await readFile(join(pack.rootDir, "en", "screenshots", "full.png"), "utf8"),
      "stitched-page",
    );
    const tree = JSON.parse(
      await readFile(join(pack.rootDir, "en", "accessibility", "full.json"), "utf8"),
    ) as { nodes: Array<{ identifier?: string }> };
    assert.equal(tree.nodes[0]?.identifier, "delete-account");
    assert.ok(pack.manifest.cases[0]?.frames.includes("en/screenshots/full.png"));
    assert.ok((await readdir(join(pack.rootDir, "en", "screenshots"))).includes("001-001.png"));
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});
