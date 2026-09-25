import { catalogSummaries, rebuildRunCatalog } from "./run-catalog.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CaptureReviewError,
  captureReviewQueueForRun,
  reviewPersistedCapture,
} from "./capture-review.js";
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

test("a review is refused when the saved frame bytes no longer match", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-review-tamper-"));
  try {
    const png = Buffer.from("original-png");
    const sha = createHash("sha256").update(png).digest("hex");
    const run = await persistRun({
      runDir: join(root, "review-tamper"),
      id: "review-tamper",
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
      artifacts: [
        {
          kind: "capture-review",
          capturedAt: 2,
          data: { caption: "Settings", framePath: "frames/001.png", imageSha256: sha },
        },
      ],
      resolvedInputs: {},
      evidencePolicy: { schemaVersion: 1, sensitive: {} },
    } as unknown as TestJob);
    await mkdir(join(run.dir, "frames"), { recursive: true });
    await writeFile(join(run.dir, "frames", "001.png"), Buffer.from("tampered"));
    const captureId = captureReviewQueueForRun(run).items[0]?.captureId;
    assert.ok(captureId);
    await assert.rejects(
      () =>
        reviewPersistedCapture(root, run, {
          captureId,
          action: "accept",
          actor: { id: "human:qa", kind: "human" },
        }),
      (error: unknown) =>
        error instanceof CaptureReviewError &&
        error.code === "CAPTURE_REVIEW_CONFLICT" &&
        /Tampered frame frames\/001\.png/u.test(error.message),
    );
    await writeFile(join(run.dir, "frames", "001.png"), png);
    const reviewed = await reviewPersistedCapture(root, run, {
      captureId,
      action: "accept",
      actor: { id: "human:qa", kind: "human" },
    });
    assert.equal(reviewed.decision.action, "accept");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second reviewer cannot replace the first saved decision", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-review-second-"));
  try {
    const run = await persistRun({
      runDir: join(root, "review-second"),
      id: "review-second",
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
      artifacts: [
        {
          kind: "capture-review",
          capturedAt: 2,
          data: { caption: "Settings", framePath: "frames/001.png", imageSha256: "a" },
        },
      ],
      resolvedInputs: {},
      evidencePolicy: { schemaVersion: 1, sensitive: {} },
    } as unknown as TestJob);
    const captureId = captureReviewQueueForRun(run).items[0]?.captureId;
    assert.ok(captureId);
    const first = await reviewPersistedCapture(root, run, {
      captureId,
      action: "report-issue",
      note: "Save overlaps the description",
      actor: { id: "human:first", kind: "human" },
    });
    await assert.rejects(
      () =>
        reviewPersistedCapture(root, run, {
          captureId,
          action: "accept",
          actor: { id: "human:second", kind: "human" },
          expectedReviewVersion: first.decision.reviewVersion,
        }),
      (error: unknown) =>
        error instanceof CaptureReviewError &&
        error.code === "CAPTURE_REVIEW_CONFLICT" &&
        /Another reviewer already saved/u.test(error.message),
    );
    const reloaded = await readCompletedPersistedRun(run.dir);
    const kept = reloaded?.captureReviews?.find((item) => item.captureId === captureId);
    assert.equal(kept?.action, "report-issue");
    assert.equal(kept?.note, "Save overlaps the description");
    assert.equal(kept?.decidedBy.id, "human:first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a delayed Looks correct cannot replace the same reviewer's newer issue", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-review-stale-"));
  try {
    const run = await persistRun({
      runDir: join(root, "review-stale"),
      id: "review-stale",
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
      artifacts: [
        {
          kind: "capture-review",
          capturedAt: 2,
          data: { caption: "Settings", framePath: "frames/001.png", imageSha256: "a" },
        },
      ],
      resolvedInputs: {},
      evidencePolicy: { schemaVersion: 1, sensitive: {} },
    } as unknown as TestJob);
    const captureId = captureReviewQueueForRun(run).items[0]?.captureId;
    assert.ok(captureId);
    const actor = { id: "human:qa", kind: "human" as const };
    const accepted = await reviewPersistedCapture(root, run, {
      captureId,
      action: "accept",
      actor,
    });
    const issue = await reviewPersistedCapture(root, run, {
      captureId,
      action: "report-issue",
      note: "Save overlaps the description",
      actor,
      expectedReviewVersion: accepted.decision.reviewVersion,
    });
    await assert.rejects(
      () =>
        reviewPersistedCapture(root, run, {
          captureId,
          action: "accept",
          actor,
          expectedReviewVersion: accepted.decision.reviewVersion,
        }),
      (error: unknown) =>
        error instanceof CaptureReviewError &&
        error.code === "CAPTURE_REVIEW_CONFLICT" &&
        /newer review decision/u.test(error.message),
    );
    const reloaded = await readCompletedPersistedRun(run.dir);
    const kept = reloaded?.captureReviews?.find((item) => item.captureId === captureId);
    assert.equal(kept?.action, "report-issue");
    assert.equal(kept?.note, "Save overlaps the description");
    assert.equal(kept?.reviewVersion, issue.decision.reviewVersion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
