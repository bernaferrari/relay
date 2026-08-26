import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CombineEvidenceControl } from "@relay/protocol";
import { FRAME_OBSERVATION_KIND, type FrameObservation } from "./frame-observation.js";
import {
  analyzeLocaleRunBatch,
  analyzeLocaleRunJobs,
  exportLocaleRunPack,
} from "./locale-run-pack.js";
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
        data: { kind: "locale-matrix", locale: input.locale },
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
        `2026-01-0${index + 1}_locale-run-evicted_serial_${locale}`,
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
          action: "locale-run-evicted",
          runDir: undefined,
        }),
      );
    }

    const report = await analyzeLocaleRunBatch("evicted");

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

test("an exported locale pack carries findings beside the frames that produced them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-locale-pack-"));
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

    const pack = await exportLocaleRunPack({ batchId: "batch-1", jobs, recipeId: "settings" });

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

  const report = analyzeLocaleRunJobs("batch-live", jobs);

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
        kind: "locale-matrix",
        locale,
        values: { locale, locale_label: index === 2 ? locale : "-", locale_identifier: locale },
      },
    };
    job.frames = [
      { path: "frames/001.png", caption: "screen: settings", capturedAt: 2 },
    ] as TestJob["frames"];
    return job;
  });

  const report = analyzeLocaleRunJobs("batch-restore", jobs);

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

  const report = analyzeLocaleRunJobs("batch-state", jobs);

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

  const report = analyzeLocaleRunJobs("batch-combine-language", jobs);

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
    const pack = await exportLocaleRunPack({ batchId: "batch-tree", jobs: [job] });
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

    const pack = await exportLocaleRunPack({ batchId: "batch-2", jobs });

    assert.deepEqual(pack.manifest.analysis.findings, []);
    assert.deepEqual(pack.manifest.locales, ["kids-on", "kids-off"]);
    assert.equal(pack.manifest.cases[0]?.frames.length, 1);
  } finally {
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});
