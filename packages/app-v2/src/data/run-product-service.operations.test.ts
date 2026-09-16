import { describe, expect, it, vi } from "vitest";
import type { Platform } from "../platform/types";
import { createRunProductService } from "./run-product-service";

const { calls, invoke } = vi.hoisted(() => {
  const calls: Array<{ id: string; input: unknown }> = [];
  const invoke = vi.fn(async (id: string, input: unknown) => {
    calls.push({ id, input });
    if (id === "run.review") return { run: {}, review: { state: "approved" } };
    if (id === "run.evidence.get")
      return { evidence: { channels: { screenshot: { entries: 2 } } } };
    if (id === "run.visual.compare")
      return { comparison: { id: "comparison-1", code: "VISUAL_CHANGED" } };
    if (id === "run.visual.review") {
      return { decision: { id: "decision-1", action: "keep-baseline" }, baseline: null };
    }
    if (id === "run.visual-policy.get") return { policy: { id: "policy-1", revision: 2 } };
    if (id === "run.visual-policy.update") {
      return { policy: { id: "policy-1", revision: 3 }, comparison: { id: "comparison-2" } };
    }
    if (id === "run.visual-baseline.update") {
      return {
        comparison: { id: "comparison-3" },
        decision: { id: "decision-2", action: "approve-new-baseline" },
        baseline: { id: "baseline-1" },
      };
    }
    if (id === "run.capture.review") {
      return {
        run: {},
        queue: { items: [], summary: { captured: 1, missing: 0, pending: 0, accepted: 1, issue: 0, needMoreEvidence: 0 } },
        decision: { captureId: "frames/001.png::aaa", action: "accept", decidedAt: 1, decidedBy: { id: "human:qa", kind: "human" } },
      };
    }
    if (id === "run.replay") return { job: { id: "replay-job-1", status: "queued" } };
    if (id === "job.get") return { job: { id: "replay-job-1", status: "ok", runId: "run-2" } };
    if (id === "job.cancel") return { job: { id: "replay-job-1", status: "cancelled" } };
    throw new Error(`Unexpected operation ${id}`);
  });
  return { calls, invoke };
});

vi.mock("./product-client", () => ({
  productClientForPlatform: async () => ({ client: { invoke }, actorId: "human:reports-test" }),
}));

describe("run report product operations", () => {
  it("uses canonical review and bounded evidence drilldown operations", async () => {
    calls.length = 0;
    const service = createRunProductService({} as Platform);
    await expect(
      service.review?.({ runId: "run-1", action: "approve", note: "Reviewed" }),
    ).resolves.toEqual({ state: "approved" });
    await expect(
      service.getEvidence?.("run-1", { testStepId: "step-1", limit: 10 }),
    ).resolves.toMatchObject({ channels: { screenshot: { entries: 2 } } });
    expect(calls.slice(0, 2)).toEqual([
      { id: "run.review", input: { runId: "run-1", action: "approve", note: "Reviewed" } },
      { id: "run.evidence.get", input: { runId: "run-1", testStepId: "step-1", limit: 10 } },
    ]);
  });

  it("exposes visual compare, policy, and baseline decisions without inventing local state", async () => {
    calls.length = 0;
    const service = createRunProductService({} as Platform);
    await expect(service.compareVisual?.("run-1")).resolves.toMatchObject({
      id: "comparison-1",
      code: "VISUAL_CHANGED",
    });
    await expect(
      service.reviewVisual?.({
        runId: "run-1",
        comparisonId: "comparison-1",
        action: "keep-baseline",
      }),
    ).resolves.toMatchObject({ decision: { id: "decision-1" }, baseline: null });
    await expect(service.getVisualPolicy?.("run-1")).resolves.toMatchObject({ revision: 2 });
    await expect(
      service.updateVisualPolicy?.({
        runId: "run-1",
        expectedRevision: 2,
        changeThreshold: 0.1,
        pixelThreshold: 8,
        regions: [],
      }),
    ).resolves.toMatchObject({ policy: { revision: 3 } });
    await expect(
      service.approveVisualBaseline?.({ runId: "run-1", action: "approve-new-baseline" }),
    ).resolves.toMatchObject({ baseline: { id: "baseline-1" } });
    await expect(
      service.reviewCapture?.({
        runId: "run-1",
        captureId: "frames/001.png::aaa",
        action: "accept",
        imageSha256: "aaa",
      }),
    ).resolves.toMatchObject({ decision: { action: "accept" } });
    expect(calls.map(({ id }) => id)).toEqual([
      "run.visual.compare",
      "run.visual.review",
      "run.visual-policy.get",
      "run.visual-policy.update",
      "run.visual-baseline.update",
      "run.capture.review",
    ]);
  });

  it("replays a persisted run and polls its canonical job", async () => {
    calls.length = 0;
    const service = createRunProductService({} as Platform);

    await expect(service.replay?.("run-1")).resolves.toEqual({ jobId: "replay-job-1" });
    await expect(service.getReplayJob?.("replay-job-1")).resolves.toEqual({
      status: "ok",
      runId: "run-2",
    });
    expect(calls.slice(-2)).toEqual([
      { id: "run.replay", input: { runId: "run-1" } },
      { id: "job.get", input: { jobId: "replay-job-1" } },
    ]);
  });

  it("cancels a queued replay through the canonical job operation", async () => {
    calls.length = 0;
    const service = createRunProductService({} as Platform);

    await expect(service.cancelReplay?.("replay-job-1")).resolves.toBeUndefined();
    expect(calls).toEqual([{ id: "job.cancel", input: { jobId: "replay-job-1" } }]);
  });
});
