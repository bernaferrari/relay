import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  getVisualBaseline,
  persistRun,
  readPersistedRun,
  resetControlDatabaseCache,
  runsRoot,
  SEEDED_MEMBER_CAPTURE_LANGUAGE_CAPTION,
  SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE,
  SEEDED_MEMBER_CAPTURE_LOOK_FOR,
  SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE,
  SEEDED_MEMBER_CAPTURE_STEP_ID,
  SEEDED_MEMBER_CAPTURE_TEST_ID,
  SEEDED_MEMBER_TARGET_ID,
  type TestJob,
} from "@relay/core";
import { captureReviewSlotId } from "@relay/protocol";
import { startServer } from "./index.js";

const organizationId = "local";
const projectId = "default";
const batchId = "seeded-member-stranger-review";
const runId = "pkg3-settings";
const capturedSha = "aaa";
const capturedCaption = "Member account settings";
const capturedFrame = "frames/001.png";

function client(port: number, actorId: string, actorKind: "human" | "agent"): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId,
    projectId,
    actorId,
    actorKind,
  });
}

function isActorRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.body as { code?: string } | undefined)?.code === "CAPTURE_REVIEW_ACTOR_REQUIRED"
  );
}

test(
  "Package 3 stranger review: distinct human accepts exact items; agent:cursor cannot impersonate",
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-seeded-stranger-"));
    const previousRuns = process.env.RELAY_RUNS_DIR;
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    process.env.RELAY_RUNS_DIR = join(root, "runs");
    process.env.RELAY_STATE_DIR = join(root, "state");
    process.env.RELAY_WORKSPACE_ROOT = root;
    resetControlDatabaseCache();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const at = Date.now();
      const settingsSlot = {
        checkpointId: SEEDED_MEMBER_CAPTURE_STEP_ID,
        stepId: SEEDED_MEMBER_CAPTURE_STEP_ID,
        attempt: 1,
        caption: capturedCaption,
        phase: SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE,
        lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
      };
      const languageSlot = {
        checkpointId: SEEDED_MEMBER_CAPTURE_STEP_ID,
        stepId: SEEDED_MEMBER_CAPTURE_STEP_ID,
        attempt: 1,
        caption: SEEDED_MEMBER_CAPTURE_LANGUAGE_CAPTION,
        phase: SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE,
        lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
      };
      await persistRun({
        id: runId,
        projectId,
        ownerId: "agent:cursor",
        action: SEEDED_MEMBER_CAPTURE_TEST_ID,
        recipeId: SEEDED_MEMBER_CAPTURE_TEST_ID,
        title: "Member settings capture for review",
        platform: "browser",
        targetKind: "browser",
        browserTargetId: SEEDED_MEMBER_TARGET_ID,
        targetContext: {
          kind: "browser",
          platform: "browser",
          targetId: SEEDED_MEMBER_TARGET_ID,
        },
        status: "ok",
        outcome: "passed",
        queuedAt: at,
        startedAt: at,
        finishedAt: at + 1,
        attempts: 1,
        logs: [],
        steps: [],
        frames: [],
        glyphs: [],
        kind: "Replay",
        tone: "acc",
        artifacts: [
          {
            kind: "app-map-test-execution-intent",
            capturedAt: at,
            data: { plan: { plannedSlots: [settingsSlot, languageSlot] } },
          },
          {
            kind: "capture-review",
            capturedAt: at,
            data: {
              caption: capturedCaption,
              lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
              framePath: capturedFrame,
              imageSha256: capturedSha,
              checkpointId: SEEDED_MEMBER_CAPTURE_STEP_ID,
              stepId: SEEDED_MEMBER_CAPTURE_STEP_ID,
              attempt: 1,
              phase: SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE,
              slotId: captureReviewSlotId(settingsSlot),
            },
          },
        ],
        recipeSnapshot: {
          id: SEEDED_MEMBER_CAPTURE_TEST_ID,
          title: "Member settings capture for review",
          source: "custom",
          steps: [],
          createdAt: at,
          updatedAt: at,
        },
        resolvedInputs: { account: "Member" },
        evidencePolicy: { schemaVersion: 1, sensitive: {} },
        batchId,
        caseIndex: 0,
      } as TestJob);

      server = await startServer({ host: "127.0.0.1", port: 0 });
      const agent = client(server.port, "agent:cursor", "agent");
      const impersonated = client(server.port, "agent:cursor", "human");
      const reviewer = client(server.port, "human:reviewer", "human");

      const listed = await agent.invoke("job.combine.capture.review", { batchId });
      assert.equal(listed.queue.summary.planned, 2);
      assert.equal(listed.queue.summary.captured, 1);
      assert.equal(listed.queue.summary.pending, 1);
      assert.equal(listed.queue.summary.missing, 1);
      assert.equal(listed.queue.summary.accepted, 0);
      const pendingOnly = await agent.invoke("job.combine.capture.review", {
        batchId,
        pending: true,
      });
      assert.equal(pendingOnly.queue.items.length, 1);
      assert.equal(pendingOnly.queue.summary.planned, 2);
      assert.equal(pendingOnly.queue.summary.pending, 1);
      assert.equal(pendingOnly.queue.summary.missing, 1);
      const pendingItem = listed.queue.items.find((item) => item.status === "pending");
      const missingItem = listed.queue.items.find((item) => item.status === "missing");
      assert.ok(pendingItem);
      assert.ok(missingItem);
      assert.equal(pendingItem.phase, SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE);
      assert.equal(missingItem.phase, SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE);

      await assert.rejects(
        () =>
          agent.invoke("job.combine.capture.review.apply", {
            batchId,
            action: "accept",
            items: [
              {
                runId: pendingItem.runId,
                captureId: pendingItem.captureId,
                imageSha256: pendingItem.imageSha256,
              },
            ],
          }),
        isActorRequired,
      );
      await assert.rejects(
        () =>
          impersonated.invoke("run.capture.review", {
            runId: pendingItem.runId,
            captureId: pendingItem.captureId,
            action: "accept",
            imageSha256: pendingItem.imageSha256,
          }),
        isActorRequired,
      );

      const accepted = await reviewer.invoke("job.combine.capture.review.apply", {
        batchId,
        action: "accept",
        items: [
          {
            runId: pendingItem.runId,
            captureId: pendingItem.captureId,
            imageSha256: pendingItem.imageSha256,
          },
          { runId: missingItem.runId, captureId: missingItem.captureId },
        ],
      });
      assert.equal(accepted.queue.summary.accepted, 1);
      assert.equal(accepted.queue.summary.missing, 1);
      assert.equal(accepted.queue.summary.pending, 0);
      assert.deepEqual(
        accepted.results.map((result) => result.status),
        ["applied", "missing"],
      );
      assert.equal(
        accepted.queue.items.find((item) => item.status === "accepted")?.decidedBy?.id,
        "human:reviewer",
      );
      assert.equal(
        await getVisualBaseline(runsRoot(), SEEDED_MEMBER_CAPTURE_TEST_ID, SEEDED_MEMBER_TARGET_ID),
        null,
      );

      await assert.rejects(
        () =>
          reviewer.invoke("run.capture.review", {
            runId: missingItem.runId,
            captureId: missingItem.captureId,
            action: "accept",
          }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === 409 &&
          (error.body as { code?: string } | undefined)?.code === "CAPTURE_REVIEW_MISSING",
      );

      await server.close();
      resetControlDatabaseCache();
      server = await startServer({ host: "127.0.0.1", port: 0 });
      const afterRestart = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId },
      );
      assert.equal(afterRestart.queue.summary.accepted, 1);
      assert.equal(afterRestart.queue.summary.missing, 1);
      assert.equal(afterRestart.queue.summary.pending, 0);
      const pendingAfterRestart = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId, pending: true },
      );
      assert.equal(pendingAfterRestart.queue.items.length, 0);
      assert.equal(pendingAfterRestart.queue.summary.accepted, 1);
      assert.equal(pendingAfterRestart.queue.summary.planned, 2);
      assert.equal(
        afterRestart.queue.items.find((item) => item.status === "accepted")?.decidedBy?.id,
        "human:reviewer",
      );
      const persisted = await readPersistedRun(runId);
      assert.equal(persisted?.captureReviews?.[0]?.decidedBy.id, "human:reviewer");
      assert.equal(persisted?.outcome, "passed");
    } finally {
      await server?.close().catch(() => undefined);
      resetControlDatabaseCache();
      if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
      else process.env.RELAY_RUNS_DIR = previousRuns;
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
      else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
      await rm(root, { recursive: true, force: true });
    }
  },
);
