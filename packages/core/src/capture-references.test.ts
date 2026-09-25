import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { captureReviewQueueForRun, reviewPersistedCapture } from "./capture-review.js";
import {
  applyCaptureReferences,
  captureDiffImageForItem,
  compareCaptureImages,
  findCaptureReference,
  updateCaptureReferenceIgnoreRegions,
} from "./capture-references.js";
import { persistRun } from "./runs.js";
import type { TestJob } from "./session.js";

const human = { id: "human:qa", kind: "human" as const };

/** A 40x20 image; `mark` paints a 4x4 red block at that position. */
function png(mark?: { x: number; y: number }): Buffer {
  const image = new PNG({ width: 40, height: 20 });
  for (let index = 0; index < 40 * 20; index += 1) {
    image.data[index * 4] = 240;
    image.data[index * 4 + 1] = 240;
    image.data[index * 4 + 2] = 240;
    image.data[index * 4 + 3] = 255;
  }
  if (mark) {
    for (let y = mark.y; y < mark.y + 4; y += 1) {
      for (let x = mark.x; x < mark.x + 4; x += 1) {
        const offset = (y * 40 + x) * 4;
        image.data[offset] = 255;
        image.data[offset + 1] = 0;
        image.data[offset + 2] = 0;
      }
    }
  }
  return PNG.sync.write(image);
}

async function captureRun(root: string, id: string, bytes: Buffer) {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const run = await persistRun({
    runDir: join(root, id),
    id,
    projectId: "default",
    action: "app-map:shop:test:checkout:root:r3",
    platform: "browser",
    serial: "chrome-admin",
    status: "ok",
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 3,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    artifacts: [
      {
        kind: "capture-review",
        capturedAt: 2,
        data: {
          caption: "Checkout",
          framePath: "frames/001.png",
          imageSha256: sha,
          checkpointId: "checkout-screen",
          attempt: 1,
        },
      },
    ],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as unknown as TestJob);
  await mkdir(join(run.dir, "frames"), { recursive: true });
  await writeFile(join(run.dir, "frames", "001.png"), bytes);
  return run;
}

test("Looks correct becomes the reference and unchanged runs pass on their own", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-reference-"));
  try {
    const first = await applyCaptureReferences(root, await captureRun(root, "run-1", png()));
    const [item] = captureReviewQueueForRun(first).items;
    assert.equal(item?.reference?.state, "new");
    assert.equal(item?.status, "pending");
    await reviewPersistedCapture(root, first, {
      captureId: item!.captureId,
      action: "accept",
      actor: human,
    });

    // Same pixels, different run and Test revision: approved automatically.
    const same = await applyCaptureReferences(root, await captureRun(root, "run-2", png()));
    const [sameItem] = captureReviewQueueForRun(same).items;
    assert.equal(sameItem?.reference?.state, "match");
    assert.equal(sameItem?.status, "accepted");
    assert.equal(sameItem?.decidedBy?.id, "system:reference");
    assert.equal(captureReviewQueueForRun(same).summary.unchanged, 1);

    // A visible change waits for a person and reports where it is.
    const changed = await applyCaptureReferences(
      root,
      await captureRun(root, "run-3", png({ x: 30, y: 10 })),
    );
    const [changedItem] = captureReviewQueueForRun(changed).items;
    assert.equal(changedItem?.reference?.state, "changed");
    assert.equal(changedItem?.status, "pending");
    assert.ok((changedItem?.reference?.changedBounds?.x ?? 0) >= 0.7);
    const diff = await captureDiffImageForItem(root, changed, changedItem!);
    assert.ok(diff && PNG.sync.read(diff).width === 40);

    // Ignoring that area makes the same run pass after comparing again.
    await updateCaptureReferenceIgnoreRegions(root, changed, changedItem!, [
      { x: 0.7, y: 0.4, width: 0.3, height: 0.6, name: "Live price" },
    ]);
    const recompared = await applyCaptureReferences(root, changed);
    const [recomparedItem] = captureReviewQueueForRun(recompared).items;
    assert.equal(recomparedItem?.reference?.state, "match");
    assert.equal(recomparedItem?.status, "accepted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a person can override an automatic approval, and withdrawing restores the old reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-reference-override-"));
  try {
    const first = await applyCaptureReferences(root, await captureRun(root, "run-1", png()));
    const [item] = captureReviewQueueForRun(first).items;
    await reviewPersistedCapture(root, first, {
      captureId: item!.captureId,
      action: "accept",
      actor: human,
    });
    const auto = await applyCaptureReferences(root, await captureRun(root, "run-2", png()));
    const [autoItem] = captureReviewQueueForRun(auto).items;
    const overridden = await reviewPersistedCapture(root, auto, {
      captureId: autoItem!.captureId,
      action: "report-issue",
      actor: { id: "human:other", kind: "human" },
      note: "Price is stale even though pixels match",
      expectedReviewVersion: autoItem!.reviewVersion,
    });
    assert.equal(overridden.decision.action, "report-issue");

    // A new image is approved, then withdrawn: the first reference applies again.
    const changedRun = await applyCaptureReferences(
      root,
      await captureRun(root, "run-3", png({ x: 2, y: 2 })),
    );
    const [changedItem] = captureReviewQueueForRun(changedRun).items;
    const accepted = await reviewPersistedCapture(root, changedRun, {
      captureId: changedItem!.captureId,
      action: "accept",
      actor: human,
    });
    assert.equal((await findCaptureReference(root, changedRun, changedItem!))?.runId, "run-3");
    await reviewPersistedCapture(root, accepted.run, {
      captureId: changedItem!.captureId,
      action: "report-issue",
      actor: human,
      expectedReviewVersion: accepted.decision.reviewVersion,
    });
    assert.equal((await findCaptureReference(root, changedRun, changedItem!))?.runId, "run-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("different sizes always count as changed", () => {
  const a = PNG.sync.read(png());
  const b = new PNG({ width: 20, height: 20 });
  assert.deepEqual(compareCaptureImages(a, b), {
    changed: true,
    sizeChanged: true,
    changeRatio: 1,
  });
});
