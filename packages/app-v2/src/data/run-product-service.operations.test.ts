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
    expect(calls.map(({ id }) => id)).toEqual([
      "run.visual.compare",
      "run.visual.review",
      "run.visual-policy.get",
      "run.visual-policy.update",
      "run.visual-baseline.update",
    ]);
  });
});
