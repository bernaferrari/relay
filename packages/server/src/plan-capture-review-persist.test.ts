import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { persistRun, readPersistedRun, resetControlDatabaseCache, type TestJob } from "@relay/core";
import {
  RC23_SCREENSHOT_FIRST_CAPTURED_PENDING,
  captureReviewSlotId,
  formatCaptureReviewCoverageSummary,
  materializeRc23ScreenshotFirstSlots,
  type PlanCaptureReviewQueue,
  type Rc23ScreenshotFirstSlot,
} from "@relay/protocol";
import { startServer } from "./index.js";

const organizationId = "local";
const projectId = "default";
const freezeBatchId = "rc23-screenshot-first-persist";
const freezeCoverage = "30 planned · 29 captured · 1 blocked · 0 missing · 29 pending · 0 accepted";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function freezeRunId(slot: Rc23ScreenshotFirstSlot): string {
  const hit = RC23_SCREENSHOT_FIRST_CAPTURED_PENDING.find(
    (item) => item.checkpointId === slot.checkpointId && item.platform === slot.platform,
  );
  return hit?.jobId ?? `rc23-${slot.platform}-${slot.checkpointId}-unbound`;
}

async function persistFreezeSlot(input: {
  slot: Rc23ScreenshotFirstSlot;
  caseIndex: number;
  at: number;
}): Promise<string> {
  const hit = RC23_SCREENSHOT_FIRST_CAPTURED_PENDING.find(
    (item) =>
      item.checkpointId === input.slot.checkpointId && item.platform === input.slot.platform,
  );
  const blocked = !hit;
  const id = freezeRunId(input.slot);
  const slotId = captureReviewSlotId(input.slot);
  await persistRun({
    id,
    projectId,
    ownerId: "agent:cursor",
    action: "rc23-screenshot-first",
    recipeId: "rc23-screenshot-first",
    title: `${input.slot.caption} · ${input.slot.platform}`,
    platform: input.slot.platform === "web" ? "browser" : input.slot.platform,
    targetKind: input.slot.platform === "web" ? "browser" : "device",
    browserTargetId: input.slot.platform === "web" ? "grok-com" : undefined,
    targetContext: {
      kind: "browser",
      platform: "browser",
      targetId: "rc23-screenshot-first",
    },
    status: blocked ? "error" : "ok",
    outcome: blocked ? "harness-failure" : "passed",
    error: blocked
      ? "iOS Imagine Unbound — navigation.tab.imagine absent. Do not invent the tab."
      : undefined,
    queuedAt: input.at,
    startedAt: input.at,
    finishedAt: input.at + 1,
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
        capturedAt: input.at,
        data: { plan: { plannedSlots: [input.slot] } },
      },
      ...(hit
        ? [
            {
              kind: "capture-review",
              capturedAt: input.at,
              data: {
                caption: input.slot.caption,
                lookFor: input.slot.caption,
                framePath: `frames/${input.slot.checkpointId}-${input.slot.platform}.png`,
                imageSha256: hit.jobId,
                checkpointId: input.slot.checkpointId,
                stepId: input.slot.checkpointId,
                attempt: 1,
                requirementId: input.slot.requirementId,
                configuration: input.slot.configuration,
                slotId,
              },
            },
          ]
        : []),
    ],
    recipeSnapshot: {
      id: "rc23-screenshot-first",
      title: `${input.slot.caption} · ${input.slot.platform}`,
      source: "custom",
      steps: [],
      createdAt: input.at,
      updatedAt: input.at,
    },
    resolvedInputs: { locale: `${input.slot.platform}-${input.slot.checkpointId}` },
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
    batchId: freezeBatchId,
    caseIndex: input.caseIndex,
    caseCount: 30,
  } as unknown as TestJob);
  return id;
}

function reviewSelections(
  items: PlanCaptureReviewQueue["items"],
): Array<{ runId: string; captureId: string; imageSha256?: string }> {
  return items.map((item) => ({
    runId: item.runId,
    captureId: item.captureId,
    ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
  }));
}

function assertFreezeCounts(summary: PlanCaptureReviewQueue["summary"]): void {
  assert.equal(summary.planned, 30);
  assert.equal(summary.captured, 29);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.missing, 0);
  assert.equal(summary.pending, 29);
  assert.equal(summary.accepted, 0);
  assert.equal(formatCaptureReviewCoverageSummary(summary), freezeCoverage);
}

test(
  "Plan capture-review freeze persists across restart and export without collapsing pending into passed",
  { timeout: 90_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-rc23-capture-persist-"));
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
      const slots = materializeRc23ScreenshotFirstSlots();
      assert.equal(slots.length, 30);
      const ids: string[] = [];
      for (const [caseIndex, slot] of slots.entries()) {
        ids.push(await persistFreezeSlot({ slot, caseIndex, at }));
      }
      assert.equal(ids.length, 30);

      server = await startServer({ host: "127.0.0.1", port: 0 });
      const agent = client(server.port, "agent:cursor", "agent");
      const impersonated = client(server.port, "agent:cursor", "human");
      const reviewer = client(server.port, "human:reviewer", "human");

      const listed = await agent.invoke("job.combine.capture.review", { batchId: freezeBatchId });
      const queue = listed.queue as PlanCaptureReviewQueue;
      assertFreezeCounts(queue.summary);
      const pending = queue.items.filter((item) => item.status === "pending");
      const blocked = queue.items.filter((item) => item.blocked);
      assert.equal(pending.length, 29);
      assert.equal(blocked.length, 1);
      assert.equal(blocked[0]?.checkpointId, "imagine");
      assert.equal(blocked[0]?.configuration?.app, "ai.x.GrokApp");

      const exported = await reviewer.invoke("job.combine.export", { batchId: freezeBatchId });
      const html = await readFile(join(exported.rootDir, "index.html"), "utf8");
      const checklist = JSON.parse(
        await readFile(join(exported.rootDir, "checklist.json"), "utf8"),
      ) as Array<{ status: string }>;
      assert.match(html, new RegExp(escapeRegExp(freezeCoverage), "u"));
      assert.doesNotMatch(html, /runs passed/u);
      assert.doesNotMatch(html, /\d+ tests passed/u);
      assert.match(html, /Looks correct does not approve a visual baseline/u);
      assert.equal(checklist.filter((row) => row.status === "pending review").length, 29);
      assert.equal(checklist.filter((row) => row.status === "could not run").length, 1);
      assert.equal(checklist.filter((row) => row.status === "passed").length, 0);

      await assert.rejects(
        () =>
          agent.invoke("job.combine.capture.review.apply", {
            batchId: freezeBatchId,
            action: "accept",
            items: reviewSelections(pending.slice(0, 2)),
          }),
        isActorRequired,
      );
      await assert.rejects(
        () =>
          impersonated.invoke("job.combine.capture.review.apply", {
            batchId: freezeBatchId,
            action: "accept",
            items: reviewSelections(pending.slice(0, 1)),
          }),
        isActorRequired,
      );
      const blockedAccept = await reviewer.invoke("job.combine.capture.review.apply", {
        batchId: freezeBatchId,
        action: "accept",
        items: [{ runId: blocked[0]!.runId, captureId: blocked[0]!.captureId }],
      });
      assert.equal(blockedAccept.results[0]?.status, "missing");
      assertFreezeCounts(blockedAccept.queue.summary);

      await server.close();
      resetControlDatabaseCache();
      server = await startServer({ host: "127.0.0.1", port: 0 });
      const afterRestart = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId: freezeBatchId },
      );
      const restartedQueue = afterRestart.queue as PlanCaptureReviewQueue;
      assertFreezeCounts(restartedQueue.summary);
      assert.equal(restartedQueue.items.find((item) => item.blocked)?.checkpointId, "imagine");
      const exportedAgain = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.export",
        { batchId: freezeBatchId },
      );
      const htmlAgain = await readFile(join(exportedAgain.rootDir, "index.html"), "utf8");
      assert.match(htmlAgain, new RegExp(escapeRegExp(freezeCoverage), "u"));
      assert.doesNotMatch(htmlAgain, /runs passed/u);
      assert.doesNotMatch(htmlAgain, /\d+ tests passed/u);

      const selected = restartedQueue.items.filter((item) => item.status === "pending").slice(0, 2);
      assert.equal(selected.length, 2);
      const applied = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review.apply",
        {
          batchId: freezeBatchId,
          action: "accept",
          items: reviewSelections(selected),
        },
      );
      assert.equal(applied.queue.summary.accepted, 2);
      assert.equal(applied.queue.summary.pending, 27);
      assert.equal(applied.queue.summary.blocked, 1);
      assert.equal(applied.queue.summary.planned, 30);
      assert.deepEqual(
        applied.results.map((result) => result.status),
        ["applied", "applied"],
      );

      await server.close();
      resetControlDatabaseCache();
      server = await startServer({ host: "127.0.0.1", port: 0 });
      const afterAccept = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId: freezeBatchId },
      );
      assert.equal(afterAccept.queue.summary.accepted, 2);
      assert.equal(afterAccept.queue.summary.pending, 27);
      assert.equal(afterAccept.queue.summary.blocked, 1);
      assert.equal(afterAccept.queue.summary.missing, 0);
      assert.equal(afterAccept.queue.summary.planned, 30);
      for (const item of selected) {
        const persisted = await readPersistedRun(item.runId);
        assert.equal(persisted?.outcome, "passed");
        assert.equal(persisted?.captureReviews?.[0]?.decidedBy.id, "human:reviewer");
      }
      const imagine = await readPersistedRun(
        freezeRunId(
          slots.find((slot) => slot.checkpointId === "imagine" && slot.platform === "ios")!,
        ),
      );
      assert.equal(imagine?.outcome, "harness-failure");
      assert.equal(imagine?.captureReviews?.length ?? 0, 0);
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
