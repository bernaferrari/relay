import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExitCode } from "./errors.js";
import { persistScrollSurvey, scrollSurveyPersistDigest } from "./survey-persist.js";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function frame(index: number, label: string) {
  return {
    index,
    offsetY: index * 100,
    appendedHeight: 100,
    screenshot: { base64: pngBase64, width: 10, height: 20, capturedAt: index + 1 },
    snapshot: {
      serial: "ipad-1",
      capturedAt: index + 2,
      nodes: [
        { identifier: `row-${index}`, label, type: "cell", hittable: true },
        { identifier: "extra", label: `full-tree-${index}`, type: "statictext", hittable: false },
      ],
      interactive: [{ identifier: `row-${index}`, label }],
      inspectable: true,
      source: "sdk",
      screenIdentity: { fingerprint: `fp-${index}` },
    },
  };
}

function survey(frames = [frame(0, "Language"), frame(1, "Data Controls")]) {
  return {
    status: "stopped" as const,
    reason: "limit-reached",
    frames,
    diagnosticFrames: [],
    mergedNodes: [],
    restoredStartViewport: true,
    message: "Relay reached the configured survey limit.",
    stitched: { base64: pngBase64, width: 10, height: 40, mime: "image/png" as const },
  };
}

test("a complete server persist digest is reused instead of writing again", () => {
  const persist = {
    status: "completed" as const,
    reason: "end-of-content",
    frameCount: 1,
    dir: "/tmp/settings",
    paths: [{ png: "/tmp/settings/00.png", json: "/tmp/settings/00.json" }],
    frames: [
      {
        index: 0,
        labelCount: 1,
        files: { png: "/tmp/settings/00.png", json: "/tmp/settings/00.json" },
      },
    ],
  };
  assert.deepEqual(scrollSurveyPersistDigest({ persist }), persist);
  assert.equal(scrollSurveyPersistDigest({ persist: { dir: "/tmp/settings" } }), undefined);
  assert.equal(scrollSurveyPersistDigest({ status: "completed" }), undefined);
});

test("persist writes numbered png+json siblings and keeps the review tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-survey-persist-"));
  const dir = join(root, "frames");
  try {
    const digest = await persistScrollSurvey(dir, survey());
    assert.deepEqual(digest, {
      status: "stopped",
      reason: "limit-reached",
      frameCount: 2,
      dir,
      paths: [
        { png: join(dir, "00.png"), json: join(dir, "00.json") },
        { png: join(dir, "01.png"), json: join(dir, "01.json") },
      ],
      frames: [
        {
          index: 0,
          offsetY: 0,
          labelCount: 2,
          files: { png: join(dir, "00.png"), json: join(dir, "00.json") },
        },
        {
          index: 1,
          offsetY: 100,
          labelCount: 2,
          files: { png: join(dir, "01.png"), json: join(dir, "01.json") },
        },
      ],
      full: {
        png: join(dir, "full.png"),
        json: join(dir, "full.json"),
        width: 10,
        height: 40,
        nodeCount: 0,
      },
    });

    assert.deepEqual(await readFile(join(dir, "00.png")), Buffer.from(pngBase64, "base64"));
    assert.deepEqual(await readFile(join(dir, "01.png")), Buffer.from(pngBase64, "base64"));
    const first = JSON.parse(await readFile(join(dir, "00.json"), "utf8")) as {
      snapshot: { nodes: unknown[] };
    };
    const second = JSON.parse(await readFile(join(dir, "01.json"), "utf8")) as {
      snapshot: { defaults?: unknown; nodes: unknown[] };
    };
    assert.equal(first.snapshot.nodes.length, 2);
    assert.deepEqual(second.snapshot.defaults, { enabled: true, visible: true });
    assert.deepEqual(second.snapshot.nodes, [
      { type: "cell", label: "Data Controls", identifier: "row-1", hittable: true },
      { type: "statictext", label: "full-tree-1", identifier: "extra", hittable: false },
    ]);
    assert.doesNotMatch(JSON.stringify(digest), /base64/u);
    assert.doesNotMatch(await readFile(join(dir, "00.json"), "utf8"), /base64/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persist fails clearly when the destination cannot be created or written", async () => {
  await assert.rejects(() => persistScrollSurvey("   ", survey()), {
    message: /non-empty folder path/u,
    exitCode: ExitCode.validation,
  });

  const root = await mkdtemp(join(tmpdir(), "relay-survey-persist-bad-"));
  const blocked = join(root, "blocked");
  try {
    await writeFile(blocked, "not a directory");
    await assert.rejects(() => persistScrollSurvey(blocked, survey()), {
      message: /Could not create survey directory/u,
      exitCode: ExitCode.validation,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("force replaces leftover survey frames instead of mixing generations", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-survey-persist-replace-"));
  try {
    await persistScrollSurvey(
      root,
      survey([frame(0, "Language"), frame(1, "Data Controls"), frame(2, "Appearance")]),
    );
    assert.deepEqual(await readdir(root).then((names) => names.sort()), [
      "00.json",
      "00.png",
      "01.json",
      "01.png",
      "02.json",
      "02.png",
      "full.json",
      "full.png",
    ]);
    const digest = await persistScrollSurvey(root, survey([frame(0, "Language")]), { force: true });
    assert.equal(digest.frameCount, 1);
    assert.deepEqual(await readdir(root).then((names) => names.sort()), [
      "00.json",
      "00.png",
      "full.json",
      "full.png",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persist refuses a non-empty dest unless force is set", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-survey-persist-force-"));
  try {
    await persistScrollSurvey(root, survey([frame(0, "Language")]));
    await assert.rejects(() => persistScrollSurvey(root, survey([frame(0, "Language")])), {
      message: /not empty/u,
      exitCode: ExitCode.conflict,
    });
    const digest = await persistScrollSurvey(root, survey([frame(0, "Appearance")]), {
      force: true,
    });
    assert.equal(digest.frameCount, 1);
    const written = JSON.parse(await readFile(join(root, "00.json"), "utf8")) as {
      snapshot: { nodes: Array<{ label?: string; hittable?: boolean }> };
    };
    assert.equal(written.snapshot.nodes[0]?.label, "Appearance");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
