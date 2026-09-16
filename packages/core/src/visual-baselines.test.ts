import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import type { PersistedRun } from "./runs.js";
import {
  approveVisualBaseline,
  compareVisualBaseline,
  getVisualBaseline,
  getVisualComparisonPolicy,
  listVisualReviews,
  reviewVisualComparison,
  updateVisualComparisonPolicy,
  VisualVerificationError,
  visualTargetKey,
} from "./visual-baselines.js";

function png(variant: string): Buffer {
  const shade = [...variant].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 256;
  const image = new PNG({ width: 4, height: 4 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = shade;
    image.data[offset + 1] = (shade * 3) % 256;
    image.data[offset + 2] = (shade * 7) % 256;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

function pngWithChangedTopLeft(changed: boolean): Buffer {
  const image = new PNG({ width: 4, height: 4 });
  for (let offset = 0; offset < image.data.length; offset += 4) image.data[offset + 3] = 255;
  if (changed) image.data[0] = 255;
  return PNG.sync.write(image);
}

/** Pixel (0,2) sits inside grok.com ui-tree reply-body / intro inference on a 4×4 frame. */
function pngWithChangedReplyBody(changed: boolean): Buffer {
  const image = new PNG({ width: 4, height: 4 });
  for (let offset = 0; offset < image.data.length; offset += 4) image.data[offset + 3] = 255;
  if (changed) image.data[(2 * 4 + 0) * 4] = 255;
  return PNG.sync.write(image);
}

const chatUiTreeArtifact = {
  kind: "ui-tree" as const,
  capturedAt: 1,
  data: {
    stepId: "chat",
    nodes: [
      { role: "article", label: "You", rect: { x: 0, y: 1, width: 1, height: 1 } },
      { role: "article", label: "Grok", rect: { x: 0, y: 2, width: 2, height: 1 } },
      {
        role: "div",
        identifier: "chat-input",
        label: "Ask Grok anything",
        rect: { x: 0, y: 2, width: 3, height: 1 },
      },
      {
        role: "dialog",
        label: "Introducing Build Mode",
        rect: { x: 0, y: 0, width: 4, height: 4 },
      },
    ],
  },
};

async function runFixture(
  root: string,
  input: {
    id: string;
    projectId?: string;
    serial?: string;
    profileId?: string;
    frames: Buffer[];
    frameStepIds?: Array<string | undefined>;
    artifacts?: PersistedRun["artifacts"];
  },
): Promise<PersistedRun> {
  const dir = join(root, `run-${input.id}`);
  await mkdir(join(dir, "frames"), { recursive: true });
  const capturedAt = 1_700_000_000_000;
  const frames = await Promise.all(
    input.frames.map(async (contents, index) => {
      const file = `${String(index + 1).padStart(3, "0")}.png`;
      await writeFile(join(dir, "frames", file), contents);
      const stepId = input.frameStepIds?.[index];
      return {
        path: `frames/${file}`,
        caption: `Frame ${index + 1}`,
        capturedAt: capturedAt + index,
        bytes: contents.byteLength,
        mime: "image/png",
        width: 100,
        height: 200,
        ...(stepId ? { stepId } : {}),
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
    artifacts: input.artifacts ?? [],
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
    assert.equal(baseline.approved.frames[0]?.bytes, first.frames[0]?.bytes);
    assert.equal(baseline.approved.frames[0]?.width, 4);
    assert.equal(baseline.approved.frames[0]?.height, 4);
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
    assert.equal(comparison.diff.algorithm, "pixel-rgba-regions-v1");
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

test("visual policies compare selected regions and ignore approved dynamic content", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-regions-"));
  try {
    const approved = await runFixture(root, {
      id: "approved",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedTopLeft(false)],
    });
    await approveVisualBaseline(root, approved);
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedTopLeft(true)],
    });
    const changed = await compareVisualBaseline(root, latest);
    assert.equal(changed.code, "VISUAL_CHANGED");
    assert.equal(changed.diff.frames[0]?.changedPixels, 1);
    assert.equal(changed.diff.frames[0]?.changeRatio, 1 / 16);

    const initial = await getVisualComparisonPolicy(root, latest);
    const policy = await updateVisualComparisonPolicy(root, latest, {
      expectedRevision: initial.revision,
      changeThreshold: initial.changeThreshold,
      pixelThreshold: initial.pixelThreshold,
      regions: [
        {
          id: "dynamic-avatar",
          name: "Dynamic avatar",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0,
          width: 0.25,
          height: 0.25,
        },
      ],
      actor: { id: "reviewer-1", kind: "human" },
    });
    assert.equal(policy.revision, 1);
    assert.equal(policy.updatedBy.id, "reviewer-1");
    const ignored = await compareVisualBaseline(root, latest);
    assert.equal(ignored.code, "VISUAL_MATCH");
    assert.equal(ignored.diff.frames[0]?.consideredPixels, 15);
    assert.equal(ignored.diff.frames[0]?.changedPixels, 0);
    assert.equal(ignored.diff.policyRevision, 1);

    await assert.rejects(
      () =>
        updateVisualComparisonPolicy(root, latest, {
          expectedRevision: 0,
          changeThreshold: 0,
          pixelThreshold: 0,
          regions: [],
          actor: { id: "reviewer-2", kind: "human" },
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "VISUAL_POLICY_REVISION_CONFLICT");
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identity-ignore is not a visual exclusion until comparison policy is updated", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-identity-ignore-"));
  try {
    const approved = await runFixture(root, {
      id: "approved",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedTopLeft(false)],
    });
    await approveVisualBaseline(root, approved);
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedTopLeft(true)],
      artifacts: [
        {
          kind: "identity-ignore",
          capturedAt: 1,
          data: { name: "reply body", x: 0, y: 0, width: 0.25, height: 0.25 },
        },
      ],
    });
    const compared = await compareVisualBaseline(root, latest);
    assert.equal(compared.code, "VISUAL_CHANGED");
    assert.equal(compared.diff.frames[0]?.changedPixels, 1);
    assert.equal(compared.policy.regions.length, 0);
    assert.equal((await getVisualComparisonPolicy(root, latest)).regions.length, 0);

    const initial = await getVisualComparisonPolicy(root, latest);
    await updateVisualComparisonPolicy(root, latest, {
      expectedRevision: initial.revision,
      changeThreshold: initial.changeThreshold,
      pixelThreshold: initial.pixelThreshold,
      regions: [
        {
          id: "reply-body",
          name: "reply body",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0,
          width: 0.25,
          height: 0.25,
        },
      ],
      actor: { id: "reviewer-1", kind: "human" },
    });
    const ignored = await compareVisualBaseline(root, latest);
    assert.equal(ignored.code, "VISUAL_MATCH");
    assert.equal(ignored.diff.frames[0]?.changedPixels, 0);
    assert.equal(ignored.policy.regions[0]?.id, "reply-body");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a chat comparison ignore does not hide a later Settings frame", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-settings-frame-"));
  try {
    const approved = await runFixture(root, {
      id: "approved",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedTopLeft(false), pngWithChangedTopLeft(false)],
    });
    await approveVisualBaseline(root, approved);
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedTopLeft(true), pngWithChangedTopLeft(true)],
      artifacts: [
        {
          kind: "identity-ignore",
          capturedAt: 1,
          data: {
            name: "reply body",
            x: 0,
            y: 0,
            width: 0.25,
            height: 0.25,
            stepId: "chat",
            frameIndex: 0,
          },
        },
      ],
    });
    const leaked = await compareVisualBaseline(root, latest);
    assert.equal(leaked.code, "VISUAL_CHANGED");
    assert.equal(leaked.policy.regions.length, 0);
    assert.equal(leaked.diff.frames[0]?.changedPixels, 1);
    assert.equal(leaked.diff.frames[1]?.changedPixels, 1);

    const initial = await getVisualComparisonPolicy(root, latest);
    await updateVisualComparisonPolicy(root, latest, {
      expectedRevision: initial.revision,
      changeThreshold: initial.changeThreshold,
      pixelThreshold: initial.pixelThreshold,
      regions: [
        {
          id: "chat-reply",
          name: "reply body",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0,
          width: 0.25,
          height: 0.25,
        },
      ],
      actor: { id: "reviewer-1", kind: "human" },
    });
    const scoped = await compareVisualBaseline(root, latest);
    assert.equal(scoped.code, "VISUAL_CHANGED");
    assert.equal(scoped.diff.frames[0]?.changedPixels, 0);
    assert.equal(scoped.diff.frames[1]?.changedPixels, 1);
    assert.equal(
      scoped.policy.regions.some((region) => region.frameIndex === 1),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Settings-only compare stays VISUAL_CHANGED on ui-tree chrome pixels until policy is updated", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-settings-only-uitree-"));
  try {
    const approved = await runFixture(root, {
      id: "approved",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedReplyBody(false)],
      frameStepIds: ["settings"],
    });
    await approveVisualBaseline(root, approved);
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedReplyBody(true)],
      frameStepIds: ["settings"],
      artifacts: [
        chatUiTreeArtifact,
        { ...chatUiTreeArtifact, data: { ...chatUiTreeArtifact.data, stepId: undefined } },
      ],
    });
    const compared = await compareVisualBaseline(root, latest);
    assert.equal(compared.code, "VISUAL_CHANGED");
    assert.equal(compared.diff.frames[0]?.changedPixels, 1);
    assert.equal(compared.policy.regions.length, 0);
    assert.equal((await getVisualComparisonPolicy(root, latest)).regions.length, 0);

    const initial = await getVisualComparisonPolicy(root, latest);
    await updateVisualComparisonPolicy(root, latest, {
      expectedRevision: initial.revision,
      changeThreshold: initial.changeThreshold,
      pixelThreshold: initial.pixelThreshold,
      regions: [
        {
          id: "settings-reply",
          name: "reply body",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0.5,
          width: 0.25,
          height: 0.25,
        },
      ],
      actor: { id: "reviewer-1", kind: "human" },
    });
    const ignored = await compareVisualBaseline(root, latest);
    assert.equal(ignored.code, "VISUAL_MATCH");
    assert.equal(ignored.diff.frames[0]?.changedPixels, 0);
    assert.equal(ignored.policy.regions[0]?.id, "settings-reply");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("later Settings frame stays VISUAL_CHANGED on Chat ui-tree chrome pixels until policy is updated", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-later-settings-uitree-"));
  try {
    const approved = await runFixture(root, {
      id: "approved",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedReplyBody(false), pngWithChangedReplyBody(false)],
      frameStepIds: ["chat", "settings"],
    });
    await approveVisualBaseline(root, approved);
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [pngWithChangedReplyBody(true), pngWithChangedReplyBody(true)],
      frameStepIds: ["chat", "settings"],
      artifacts: [chatUiTreeArtifact],
    });
    const compared = await compareVisualBaseline(root, latest);
    assert.equal(compared.code, "VISUAL_CHANGED");
    assert.equal(compared.policy.regions.length, 0);
    assert.equal(compared.diff.frames[0]?.changedPixels, 1);
    assert.equal(compared.diff.frames[1]?.changedPixels, 1);

    const initial = await getVisualComparisonPolicy(root, latest);
    await updateVisualComparisonPolicy(root, latest, {
      expectedRevision: initial.revision,
      changeThreshold: initial.changeThreshold,
      pixelThreshold: initial.pixelThreshold,
      regions: [
        {
          id: "chat-reply",
          name: "reply body",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0.5,
          width: 0.25,
          height: 0.25,
        },
      ],
      actor: { id: "reviewer-1", kind: "human" },
    });
    const scoped = await compareVisualBaseline(root, latest);
    assert.equal(scoped.code, "VISUAL_CHANGED");
    assert.equal(scoped.diff.frames[0]?.changedPixels, 0);
    assert.equal(scoped.diff.frames[1]?.changedPixels, 1);
    assert.equal(
      scoped.policy.regions.some((region) => region.frameIndex === 1),
      false,
    );
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

test("visual review refuses agent:* and lets human:local-cli approve a new baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-review-actor-"));
  try {
    const latest = await runFixture(root, {
      id: "latest",
      projectId: "project-a",
      serial: "pixel-1",
      frames: [png("new")],
    });
    const comparison = await compareVisualBaseline(root, latest);
    await assert.rejects(
      () =>
        reviewVisualComparison(root, latest, {
          comparisonId: comparison.id,
          action: "approve-new-baseline",
          actor: { id: "agent:cursor", kind: "agent" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof VisualVerificationError);
        assert.equal(error.code, "VISUAL_REVIEW_AGENT_FORBIDDEN");
        return true;
      },
    );
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-1", "project-a"))?.runId,
      undefined,
    );
    const approval = await reviewVisualComparison(root, latest, {
      comparisonId: comparison.id,
      action: "approve-new-baseline",
      actor: { id: "human:local-cli", kind: "human" },
    });
    assert.equal(approval.decision.resultCode, "VISUAL_BASELINE_APPROVED");
    assert.equal(approval.decision.actor.id, "human:local-cli");
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-1", "project-a"))?.runId,
      "latest",
    );
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
