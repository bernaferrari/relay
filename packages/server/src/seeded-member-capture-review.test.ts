import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  getVisualBaseline,
  persistPersistedRun,
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
  SEEDED_MEMBER_DEFECT_SEATS,
  SEEDED_MEMBER_SESSION_COOKIE,
  SEEDED_MEMBER_TARGET_ID,
  listenSeededMemberApp,
  mintSeededMemberSession,
  seededMemberCaptureConfigurations,
  type TestJob,
} from "@relay/core";
import { captureReviewSlotId, formatCaptureReviewCoverageSummary } from "@relay/protocol";
import type { PlanCaptureReviewQueue } from "@relay/protocol";
import { startServer } from "./index.js";

const organizationId = "local";
const projectId = "default";
const batchId = "seeded-member-stranger-review";
const runId = "pkg3-settings";
const imagineRunId = "pkg3-imagine-unbound";
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
      } as unknown as TestJob);
      const imagineSlot = {
        checkpointId: "imagine",
        stepId: "imagine",
        attempt: 1,
        caption: "Imagine",
        lookFor: "Imagine tab is present",
      };
      await persistRun({
        id: imagineRunId,
        projectId,
        ownerId: "agent:cursor",
        action: SEEDED_MEMBER_CAPTURE_TEST_ID,
        recipeId: SEEDED_MEMBER_CAPTURE_TEST_ID,
        title: "Imagine Unbound",
        platform: "ios",
        targetKind: "device",
        targetContext: {
          kind: "browser",
          platform: "browser",
          targetId: SEEDED_MEMBER_TARGET_ID,
        },
        status: "error",
        outcome: "harness-failure",
        error: "iOS Imagine Unbound — navigation.tab.imagine absent. Do not invent the tab.",
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
            data: { plan: { plannedSlots: [imagineSlot] } },
          },
        ],
        recipeSnapshot: {
          id: SEEDED_MEMBER_CAPTURE_TEST_ID,
          title: "Imagine Unbound",
          source: "custom",
          steps: [],
          createdAt: at,
          updatedAt: at,
        },
        resolvedInputs: { account: "Member" },
        evidencePolicy: { schemaVersion: 1, sensitive: {} },
        batchId,
        caseIndex: 1,
      } as unknown as TestJob);

      server = await startServer({ host: "127.0.0.1", port: 0 });
      const agent = client(server.port, "agent:cursor", "agent");
      const impersonated = client(server.port, "agent:cursor", "human");
      const reviewer = client(server.port, "human:reviewer", "human");

      const listed = await agent.invoke("job.combine.capture.review", { batchId });
      const queue = listed.queue as PlanCaptureReviewQueue;
      assert.equal(queue.summary.planned, 3);
      assert.equal(queue.summary.captured, 1);
      assert.equal(queue.summary.pending, 1);
      assert.equal(queue.summary.missing, 1);
      assert.equal(queue.summary.blocked, 1);
      assert.equal(queue.summary.accepted, 0);
      const pendingOnly = await agent.invoke("job.combine.capture.review", {
        batchId,
        pending: true,
      });
      assert.equal(pendingOnly.queue.items.length, 1);
      assert.equal(pendingOnly.queue.summary.planned, 3);
      assert.equal(pendingOnly.queue.summary.pending, 1);
      assert.equal(pendingOnly.queue.summary.missing, 1);
      assert.equal(pendingOnly.queue.summary.blocked, 1);
      const pendingItem = queue.items.find((item) => item.status === "pending");
      const missingItem = queue.items.find((item) => item.status === "missing" && !item.blocked);
      const blockedItem = queue.items.find((item) => item.blocked);
      assert.ok(pendingItem);
      assert.ok(missingItem);
      assert.ok(blockedItem);
      assert.equal(pendingItem.phase, SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE);
      assert.equal(missingItem.phase, SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE);
      assert.equal(blockedItem.caption, "Imagine");

      await assert.rejects(
        () =>
          agent.invoke("job.combine.capture.review.apply", {
            batchId,
            action: "accept",
            items: [
              {
                runId: persistedRunId(pendingItem),
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
            runId: persistedRunId(pendingItem),
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
            runId: persistedRunId(pendingItem),
            captureId: pendingItem.captureId,
            imageSha256: pendingItem.imageSha256,
          },
          { runId: persistedRunId(missingItem), captureId: missingItem.captureId },
          { runId: persistedRunId(blockedItem), captureId: blockedItem.captureId },
        ],
      });
      const acceptedQueue = accepted.queue as PlanCaptureReviewQueue;
      assert.equal(acceptedQueue.summary.accepted, 1);
      assert.equal(acceptedQueue.summary.missing, 1);
      assert.equal(acceptedQueue.summary.blocked, 1);
      assert.equal(acceptedQueue.summary.pending, 0);
      assert.deepEqual(
        accepted.results.map((result) => result.status),
        ["applied", "missing", "missing"],
      );
      assert.equal(
        acceptedQueue.items.find((item) => item.status === "accepted")?.decidedBy?.id,
        "human:reviewer",
      );
      assert.equal(
        await getVisualBaseline(runsRoot(), SEEDED_MEMBER_CAPTURE_TEST_ID, SEEDED_MEMBER_TARGET_ID),
        null,
      );

      await assert.rejects(
        () =>
          reviewer.invoke("run.capture.review", {
            runId: persistedRunId(missingItem),
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
      const restarted = afterRestart.queue as PlanCaptureReviewQueue;
      assert.equal(restarted.summary.accepted, 1);
      assert.equal(restarted.summary.missing, 1);
      assert.equal(restarted.summary.blocked, 1);
      assert.equal(restarted.summary.pending, 0);
      const pendingAfterRestart = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId, pending: true },
      );
      assert.equal(pendingAfterRestart.queue.items.length, 0);
      assert.equal(pendingAfterRestart.queue.summary.accepted, 1);
      assert.equal(pendingAfterRestart.queue.summary.planned, 3);
      assert.equal(pendingAfterRestart.queue.summary.blocked, 1);
      assert.equal(
        restarted.items.find((item) => item.status === "accepted")?.decidedBy?.id,
        "human:reviewer",
      );
      const persisted = await readPersistedRun(runId);
      assert.equal(persisted?.captureReviews?.[0]?.decidedBy.id, "human:reviewer");
      assert.equal(persisted?.outcome, "passed");
      const imaginePersisted = await readPersistedRun(imagineRunId);
      assert.equal(imaginePersisted?.outcome, "harness-failure");
      const exported = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.export",
        { batchId },
      );
      const html = await readFile(join(exported.rootDir, "index.html"), "utf8");
      const coverage = formatCaptureReviewCoverageSummary(restarted.summary);
      assert.match(html, new RegExp(coverage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      assert.doesNotMatch(html, /runs passed/u);
      assert.doesNotMatch(html, /\d+ tests passed/u);
      assert.match(html, /Looks correct does not approve a visual baseline/u);
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

test(
  "eight seeded capture configurations persist through Relay review, restart, repair, and export",
  { timeout: 90_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-seeded-eight-"));
    const previousRuns = process.env.RELAY_RUNS_DIR;
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.RELAY_RUNS_DIR = join(root, "runs");
    process.env.RELAY_STATE_DIR = join(root, "state");
    process.env.RELAY_WORKSPACE_ROOT = root;
    delete process.env.OPENROUTER_API_KEY;
    resetControlDatabaseCache();
    const eightBatchId = "seeded-member-eight-config";
    const { server: fixture, url, app } = await listenSeededMemberApp({ defect: true });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const cells = seededMemberCaptureConfigurations();
      assert.equal(cells.length, 8);
      const at = Date.now();
      const runIds: string[] = [];
      for (const [index, cell] of cells.entries()) {
        const token = mintSeededMemberSession(cell.role);
        const settings = await fetch(new URL("/settings", url), {
          headers: {
            cookie: `${SEEDED_MEMBER_SESSION_COOKIE}=${token}`,
            "accept-language": cell.locale.tag,
          },
        });
        const html = await settings.text();
        assert.match(html, new RegExp(`id="session-role">${cell.role}`));
        assert.match(html, /id="save-settings"/);
        assert.match(html, /layout-defect/);
        if (cell.locale.id === "ar") {
          assert.match(html, /dir="rtl"/);
        }
        if (cell.role === "member") {
          assert.match(html, new RegExp(`id="team-seats"[^>]*>${SEEDED_MEMBER_DEFECT_SEATS}`));
        }
        const imageSha256 = createHash("sha256")
          .update(html)
          .update(`\n${cell.viewport.width}x${cell.viewport.height}`)
          .digest("hex");
        const id = `eight-${String(index).padStart(2, "0")}`;
        runIds.push(id);
        const slot = {
          checkpointId: SEEDED_MEMBER_CAPTURE_STEP_ID,
          stepId: SEEDED_MEMBER_CAPTURE_STEP_ID,
          attempt: 1,
          caption: cell.caption,
          lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
          configuration: {
            account: cell.role === "member" ? "Member" : "Admin",
            viewport: `${cell.viewport.width}×${cell.viewport.height}`,
            locale: cell.locale.tag,
          },
        };
        await persistRun({
          id,
          projectId,
          ownerId: "agent:cursor",
          action: SEEDED_MEMBER_CAPTURE_TEST_ID,
          recipeId: SEEDED_MEMBER_CAPTURE_TEST_ID,
          title: cell.caption,
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
              data: { plan: { plannedSlots: [slot] } },
            },
            {
              kind: "capture-review",
              capturedAt: at,
              data: {
                caption: cell.caption,
                lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
                framePath: `frames/${String(index + 1).padStart(3, "0")}.png`,
                imageSha256,
                checkpointId: SEEDED_MEMBER_CAPTURE_STEP_ID,
                stepId: SEEDED_MEMBER_CAPTURE_STEP_ID,
                attempt: 1,
                configuration: slot.configuration,
                slotId: captureReviewSlotId(slot),
              },
            },
          ],
          recipeSnapshot: {
            id: SEEDED_MEMBER_CAPTURE_TEST_ID,
            title: cell.caption,
            source: "custom",
            steps: [],
            createdAt: at,
            updatedAt: at,
          },
          resolvedInputs: { account: slot.configuration.account, locale: cell.locale.tag },
          evidencePolicy: { schemaVersion: 1, sensitive: {} },
          batchId: eightBatchId,
          caseIndex: index,
          caseCount: 8,
        } as unknown as TestJob);
      }

      server = await startServer({ host: "127.0.0.1", port: 0 });
      const agent = client(server.port, "agent:cursor", "agent");
      const reviewer = client(server.port, "human:reviewer", "human");
      const listed = await agent.invoke("job.combine.capture.review", { batchId: eightBatchId });
      const queue = listed.queue as PlanCaptureReviewQueue;
      assert.equal(queue.summary.planned, 8);
      assert.equal(queue.summary.captured, 8);
      assert.equal(queue.summary.pending, 8);
      assert.equal(queue.summary.accepted, 0);
      assert.equal(new Set(queue.items.map((item) => item.caption)).size, 8);
      assert.equal(
        queue.items.every((item) => item.lookFor === SEEDED_MEMBER_CAPTURE_LOOK_FOR),
        true,
      );
      const memberDesktopEn = queue.items.find(
        (item) =>
          item.configuration?.account === "Member" &&
          item.configuration?.viewport === "900×600" &&
          item.configuration?.locale === "en-US",
      );
      assert.ok(memberDesktopEn);
      await assert.rejects(
        () =>
          agent.invoke("job.combine.capture.review.apply", {
            batchId: eightBatchId,
            action: "accept",
            items: [
              {
                runId: persistedRunId(memberDesktopEn),
                captureId: memberDesktopEn.captureId,
                imageSha256: memberDesktopEn.imageSha256,
              },
            ],
          }),
        isActorRequired,
      );
      const wrongAccount = await reviewer.invoke("job.combine.capture.review.apply", {
        batchId: eightBatchId,
        action: "accept",
        account: "Admin",
        items: [
          {
            runId: persistedRunId(memberDesktopEn),
            captureId: memberDesktopEn.captureId,
            imageSha256: memberDesktopEn.imageSha256,
          },
        ],
      });
      assert.equal(wrongAccount.results[0]?.status, "not-found");
      assert.equal(wrongAccount.queue.summary.accepted, 0);
      const stale = await reviewer.invoke("job.combine.capture.review.apply", {
        batchId: eightBatchId,
        action: "accept",
        items: [
          {
            runId: persistedRunId(memberDesktopEn),
            captureId: memberDesktopEn.captureId,
            imageSha256: "stale",
          },
        ],
      });
      assert.equal(stale.results[0]?.status, "conflict");
      const defectNote = "Save overlaps seats";
      const reported = await reviewer.invoke("job.combine.capture.review.apply", {
        batchId: eightBatchId,
        action: "report-issue",
        items: [
          {
            runId: persistedRunId(memberDesktopEn),
            captureId: memberDesktopEn.captureId,
            imageSha256: memberDesktopEn.imageSha256,
            note: defectNote,
          },
        ],
      });
      assert.equal(reported.results[0]?.status, "applied");
      assert.equal(reported.queue.summary.issue, 1);
      assert.equal(reported.queue.summary.pending, 7);
      assert.equal(
        reported.queue.items.find((item) => item.captureId === memberDesktopEn.captureId)?.note,
        defectNote,
      );

      await server.close();
      resetControlDatabaseCache();
      server = await startServer({ host: "127.0.0.1", port: 0 });
      const afterIssue = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId: eightBatchId },
      );
      assert.equal(afterIssue.queue.summary.issue, 1);
      assert.equal(
        afterIssue.queue.items.find((item) => item.captureId === memberDesktopEn.captureId)?.note,
        defectNote,
      );
      const persistedIssue = await readPersistedRun(persistedRunId(memberDesktopEn));
      assert.equal(persistedIssue?.outcome, "passed");
      assert.equal(persistedIssue?.captureReviews?.[0]?.note, defectNote);

      await server.close();
      resetControlDatabaseCache();
      app.setDefect(false);
      const repairedHtml = await (
        await fetch(new URL("/settings", url), {
          headers: {
            cookie: `${SEEDED_MEMBER_SESSION_COOKIE}=${mintSeededMemberSession("member")}`,
            "accept-language": "en-US",
          },
        })
      ).text();
      assert.doesNotMatch(repairedHtml, /<body class="layout-defect">/);
      const repairedSha = createHash("sha256")
        .update(repairedHtml)
        .update("\n900x600")
        .digest("hex");
      assert.notEqual(repairedSha, memberDesktopEn.imageSha256);
      const latest = await readPersistedRun(persistedRunId(memberDesktopEn));
      assert.ok(latest);
      const recaptured = structuredClone(latest);
      recaptured.artifacts = recaptured.artifacts.map((artifact) => {
        if (artifact.kind !== "capture-review") return artifact;
        const data = artifact.data as Record<string, unknown>;
        return { ...artifact, data: { ...data, imageSha256: repairedSha } };
      });
      await persistPersistedRun(runsRoot(), latest, recaptured, "capture-review");

      server = await startServer({ host: "127.0.0.1", port: 0 });
      const afterRecapture = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId: eightBatchId },
      );
      const repairedItem = afterRecapture.queue.items.find(
        (item) => item.runId === memberDesktopEn.runId,
      );
      assert.ok(repairedItem);
      assert.equal(repairedItem.status, "pending");
      assert.equal(repairedItem.imageSha256, repairedSha);
      assert.notEqual(repairedItem.captureId, memberDesktopEn.captureId);
      const staleIdentity = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review.apply",
        {
          batchId: eightBatchId,
          action: "accept",
          items: [
            {
              runId: persistedRunId(repairedItem),
              captureId: repairedItem.captureId,
              imageSha256: memberDesktopEn.imageSha256,
            },
          ],
        },
      );
      assert.equal(staleIdentity.results[0]?.status, "conflict");
      const accepted = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review.apply",
        {
          batchId: eightBatchId,
          action: "accept",
          items: [
            {
              runId: persistedRunId(repairedItem),
              captureId: repairedItem.captureId,
              imageSha256: repairedSha,
            },
          ],
        },
      );
      assert.equal(accepted.results[0]?.status, "applied");
      assert.equal(accepted.queue.summary.accepted, 1);
      assert.equal(accepted.queue.summary.pending, 7);
      assert.equal(accepted.queue.summary.issue, 0);
      assert.equal(
        await getVisualBaseline(runsRoot(), SEEDED_MEMBER_CAPTURE_TEST_ID, SEEDED_MEMBER_TARGET_ID),
        null,
      );

      await server.close();
      resetControlDatabaseCache();
      server = await startServer({ host: "127.0.0.1", port: 0 });
      const afterAccept = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.capture.review",
        { batchId: eightBatchId },
      );
      assert.equal(afterAccept.queue.summary.accepted, 1);
      assert.equal(afterAccept.queue.summary.pending, 7);
      assert.equal(afterAccept.queue.summary.planned, 8);
      const persistedRepaired = await readPersistedRun(persistedRunId(memberDesktopEn));
      assert.equal(persistedRepaired?.outcome, "passed");
      assert.equal(
        persistedRepaired?.captureReviews?.find((item) => item.captureId === repairedItem.captureId)
          ?.action,
        "accept",
      );
      const exported = await client(server.port, "human:reviewer", "human").invoke(
        "job.combine.export",
        { batchId: eightBatchId },
      );
      const exportedHtml = await readFile(join(exported.rootDir, "index.html"), "utf8");
      const coverage = formatCaptureReviewCoverageSummary(afterAccept.queue.summary);
      assert.match(exportedHtml, new RegExp(coverage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      assert.doesNotMatch(exportedHtml, /runs passed/u);
      assert.match(exportedHtml, /Looks correct does not approve a visual baseline/u);
      assert.equal(runIds.length, 8);
    } finally {
      await server?.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) =>
        fixture.close((error) => (error ? reject(error) : resolve())),
      );
      resetControlDatabaseCache();
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
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

function persistedRunId(item: { runId?: string }): string {
  assert.ok(item.runId, "This fixture must have a persisted Run");
  return item.runId;
}
