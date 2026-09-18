import { catalogSummaries, rebuildRunCatalog } from "./run-catalog.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureReviewQueueForRun, reviewPersistedCapture } from "./capture-review.js";
import { persistRun, readCompletedPersistedRun } from "./runs.js";
import type { TestJob } from "./session.js";

test("retrying an earlier screenshot returns its exact persisted decision", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-review-retry-"));
  try {
    const run = await persistRun({
      runDir: join(root, "review-retry"),
      id: "review-retry",
      action: "capture",
      platform: "browser",
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
      artifacts: ["a", "b"].map((name) => ({
        kind: "capture-review",
        capturedAt: 2,
        data: { caption: name, framePath: `frames/${name}.png`, imageSha256: name },
      })),
      resolvedInputs: {},
      evidencePolicy: { schemaVersion: 1, sensitive: {} },
    } as unknown as TestJob);
    await rebuildRunCatalog(root);
    assert.equal((await catalogSummaries(root))[0]?.captureSummary?.pending, 2);
    const [a, b] = captureReviewQueueForRun(run).items;
    assert.ok(a && b);
    const input = {
      captureId: a.captureId,
      action: "accept" as const,
      actor: { id: "human:qa", kind: "human" as const },
    };
    const first = await reviewPersistedCapture(root, run, input);
    await reviewPersistedCapture(root, run, { ...input, captureId: b.captureId });
    assert.equal((await catalogSummaries(root))[0]?.captureSummary?.accepted, 2);
    await rebuildRunCatalog(root, { preserveExisting: true });
    assert.equal((await catalogSummaries(root))[0]?.captureSummary?.pending, 0);
    assert.equal((await catalogSummaries(root))[0]?.captureSummary?.accepted, 2);
    const retry = await reviewPersistedCapture(root, run, input);
    assert.deepEqual(retry.decision, first.decision);
    const annotated = await reviewPersistedCapture(root, run, {
      ...input,
      note: "Text is legible",
      expectedReviewVersion: first.decision.reviewVersion,
    });
    assert.equal(annotated.decision.captureId, a.captureId);
    assert.equal(annotated.decision.note, "Text is legible");
    const reloaded = await readCompletedPersistedRun(run.dir);
    assert.equal(reloaded?.captureReviews?.length, 2);
    assert.equal(
      reloaded?.captureReviews?.find((item) => item.captureId === a.captureId)?.note,
      "Text is legible",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
