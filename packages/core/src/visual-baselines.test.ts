import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PersistedRun } from "./runs.js";
import {
  approveVisualBaseline,
  compareVisualBaseline,
  getVisualBaseline,
  listVisualReviews,
  reviewVisualComparison,
  visualTargetKey,
} from "./visual-baselines.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function png(variant: string): Buffer {
  return Buffer.concat([ONE_PIXEL_PNG, Buffer.from(variant)]);
}

async function runFixture(
  root: string,
  input: {
    id: string;
    projectId?: string;
    serial?: string;
    profileId?: string;
    frames: Buffer[];
  },
): Promise<PersistedRun> {
  const dir = join(root, `run-${input.id}`);
  await mkdir(join(dir, "frames"), { recursive: true });
  const capturedAt = 1_700_000_000_000;
  const frames = await Promise.all(
    input.frames.map(async (contents, index) => {
      const file = `${String(index + 1).padStart(3, "0")}.png`;
      await writeFile(join(dir, "frames", file), contents);
      return {
        path: `frames/${file}`,
        caption: `Frame ${index + 1}`,
        capturedAt: capturedAt + index,
        bytes: contents.byteLength,
        mime: "image/png",
        width: 100,
        height: 200,
      };
    }),
  );
  return {
    schemaVersion: 5,
    id: input.id,
    projectId: input.projectId,
    ownerId: "owner-1",
    action: "sign-in",
    serial: input.serial,
    platform: "android",
    targetProfile: input.profileId
      ? {
          id: input.profileId,
          targetId: input.serial ?? "pixel",
          source: "device",
          platform: "android",
          name: input.profileId,
          capabilities: [],
          observedAt: capturedAt,
        }
      : undefined,
    status: "ok",
    attempts: 1,
    queuedAt: capturedAt,
    startedAt: capturedAt,
    finishedAt: capturedAt + 100,
    logs: [],
    steps: [],
    frames,
    dir,
    writtenAt: capturedAt + 100,
    artifacts: [],
    inputDigest: `digest-${input.id}`,
    resolvedInputs: {},
  };
}

test("approved baselines snapshot exact PNG metadata and remain isolated by project and target", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-baselines-"));
  try {
    const first = await runFixture(root, {
      id: "run-1",
      projectId: "project-a",
      profileId: "pixel-android-16",
      frames: [png("approved-a"), png("approved-b")],
    });
    const baseline = await approveVisualBaseline(root, first, {
      id: "reviewer-1",
      kind: "human",
    });
    assert.equal(baseline.schemaVersion, 2);
    assert.equal(baseline.approved.frameCount, 2);
    assert.equal(baseline.approved.frames[0]?.bytes, ONE_PIXEL_PNG.byteLength + 10);
    assert.equal(baseline.approved.frames[0]?.width, 1);
    assert.equal(baseline.approved.frames[0]?.height, 1);
    assert.match(baseline.approved.frames[0]?.sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(
      baseline.approved.frames[0]?.artifactPath ?? "",
      /^\.visual-baseline-artifacts\//u,
    );
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-android-16", "project-a"))?.runId,
      "run-1",
    );
    assert.equal(await getVisualBaseline(root, "sign-in", "pixel-android-16", "project-b"), null);

    const otherTarget = await runFixture(root, {
      id: "run-2",
      projectId: "project-a",
      profileId: "tablet-android-16",
      frames: [png("tablet")],
    });
    await approveVisualBaseline(root, otherTarget);
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-android-16", "project-a"))?.runId,
      "run-1",
    );
    assert.equal(visualTargetKey(first), "pixel-android-16");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("comparison persists approved, latest, and deterministic frame diff metadata without approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-comparison-"));
  try {
    const approved = await runFixture(root, {
      id: "approved",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [png("same"), png("before"), png("removed")],
    });
    await approveVisualBaseline(root, approved);
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [png("same"), png("after"), png("added-but-third")],
    });
    const comparison = await compareVisualBaseline(root, latest);
    assert.equal(comparison.code, "VISUAL_CHANGED");
    assert.equal(comparison.approved?.runId, "approved");
    assert.equal(comparison.latest.runId, "latest");
    assert.equal(comparison.diff.algorithm, "exact-png-sha256-v1");
    assert.equal(comparison.diff.matchedFrames, 1);
    assert.equal(comparison.diff.changedFrames, 2);
    assert.deepEqual(
      comparison.diff.frames.map((frame) => frame.code),
      ["FRAME_MATCH", "FRAME_CHANGED", "FRAME_CHANGED"],
    );
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-1", "project-a"))?.runId,
      "approved",
      "comparison must not auto-promote the latest run",
    );
    const repeated = await compareVisualBaseline(root, latest);
    assert.equal(repeated.id, comparison.id, "comparison identity is idempotent for the evidence");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review actions are explicit, attributable, and only approval changes the baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-review-"));
  try {
    const approved = await runFixture(root, {
      id: "approved",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [png("approved")],
    });
    await approveVisualBaseline(root, approved);
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [png("changed")],
    });
    const comparison = await compareVisualBaseline(root, latest);
    const actor = { id: "person-1", kind: "human" as const };

    for (const [action, expectedCode] of [
      ["keep-baseline", "VISUAL_BASELINE_KEPT"],
      ["fix-connection", "VISUAL_FIX_REQUESTED"],
      ["retry", "VISUAL_RETRY_REQUESTED"],
      ["mark-expected-variation", "VISUAL_EXPECTED_VARIATION_RECORDED"],
    ] as const) {
      const result = await reviewVisualComparison(root, latest, {
        comparisonId: comparison.id,
        action,
        actor,
        note: `Decision: ${action}`,
      });
      assert.equal(result.decision.resultCode, expectedCode);
      assert.equal(result.decision.actor.id, "person-1");
      assert.equal(result.baseline?.runId, "approved");
    }
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-1", "project-a"))?.runId,
      "approved",
    );
    const expected = await compareVisualBaseline(root, latest);
    assert.equal(expected.code, "VISUAL_EXPECTED_VARIATION");

    const approval = await reviewVisualComparison(root, latest, {
      comparisonId: comparison.id,
      action: "approve-new-baseline",
      actor,
    });
    assert.equal(approval.decision.resultCode, "VISUAL_BASELINE_APPROVED");
    assert.equal(approval.baseline?.runId, "latest");
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-1", "project-a"))?.runId,
      "latest",
    );
    assert.equal((await listVisualReviews(root, comparison.id)).length, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a run without an approved baseline returns stable missing-baseline evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-missing-"));
  try {
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [png("new")],
    });
    const comparison = await compareVisualBaseline(root, latest);
    assert.equal(comparison.code, "VISUAL_BASELINE_MISSING");
    assert.equal(comparison.baseline, null);
    assert.equal(comparison.diff.addedFrames, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt screenshot evidence fails with an actionable stable code", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-corrupt-"));
  try {
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [Buffer.from("not-a-png")],
    });
    await assert.rejects(
      () => compareVisualBaseline(root, latest),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "VISUAL_FRAME_INVALID_PNG");
        assert.match((error as Error).message, /not a valid PNG/u);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
