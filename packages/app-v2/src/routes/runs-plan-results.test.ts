import { describe, expect, it } from "vitest";
import type { ProductRunSummary } from "@relay/product/catalog";
import { collapsePlanResultRows, resultRowHref } from "./runs-plan-results";

function run(
  input: Pick<ProductRunSummary, "id" | "title" | "phase" | "queuedAt"> &
    Partial<ProductRunSummary>,
): ProductRunSummary {
  return {
    action: "canonical execution action",
    status: input.phase,
    identity: { runId: input.id },
    links: {
      self: `/runs/${input.id}`,
      ...(input.batchId ? { batch: `/batches/${input.batchId}` } : {}),
    },
    ...input,
  };
}

describe("Plan Result rows", () => {
  it("collapses Run Across cells onto one Plan Result that opens the grid", () => {
    const upload = run({
      id: "run-upload",
      title: "Upload a file while logged out",
      testName: "Upload a file while logged out",
      appMapId: "grok-web",
      appName: "Grok.com daily",
      phase: "completed",
      outcome: "passed",
      queuedAt: 2,
      finishedAt: 12,
      batchId: "batch-daily",
      caseCount: 8,
    });
    const imagine = run({
      id: "run-imagine",
      title: "Open Imagine",
      testName: "Open Imagine",
      appMapId: "grok-web",
      appName: "Grok.com daily",
      phase: "completed",
      outcome: "passed",
      queuedAt: 1,
      finishedAt: 10,
      batchId: "batch-daily",
    });
    const solo = run({
      id: "run-solo",
      title: "Change language",
      phase: "completed",
      outcome: "passed",
      queuedAt: 3,
    });
    const rows = collapsePlanResultRows([upload, imagine, solo]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.title).toBe("Grok.com daily Result");
    expect(rows[0]?.batchId).toBe("batch-daily");
    expect(rows[0]?.caseCount).toBe(8);
    expect(resultRowHref(rows[0]!)).toBe("/batches/batch-daily");
    expect(rows[1]?.id).toBe("run-solo");
    expect(resultRowHref(rows[1]!)).toBe("/runs/run-solo");
  });

  it("keeps a Plan Result failed when any cell failed", () => {
    const rows = collapsePlanResultRows([
      run({
        id: "run-ok",
        title: "Open grok.com",
        appName: "Grok.com daily",
        phase: "completed",
        outcome: "passed",
        queuedAt: 1,
        batchId: "batch-1",
      }),
      run({
        id: "run-fail",
        title: "Send hello",
        appName: "Grok.com daily",
        phase: "failed",
        outcome: "product-failure",
        queuedAt: 2,
        batchId: "batch-1",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phase).toBe("failed");
    expect(rows[0]?.outcome).toBe("product-failure");
    expect(resultRowHref(rows[0]!)).toBe("/batches/batch-1");
  });

  it("uses the saved Plan name from the job title, not a generic app Result", () => {
    const rows = collapsePlanResultRows([
      run({
        id: "run-hourly",
        title: "Grok.com hourly signed-in chrome · logged-out · Open grok.com signed-in",
        appName: "Grok.com daily",
        phase: "completed",
        outcome: "passed",
        queuedAt: 1,
        batchId: "batch-hourly",
      }),
    ]);
    expect(rows[0]?.title).toBe("Grok.com hourly signed-in chrome");
    expect(resultRowHref(rows[0]!)).toBe("/batches/batch-hourly");
  });
});
