import { describe, expect, it } from "vitest";
import type { ProductRunSummary } from "@relay/product/catalog";
import {
  collapsePlanResultRows,
  planResultListCause,
  resultRowHref,
  screenshotReviewLabel,
} from "./runs-plan-results";

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
  it("keeps screenshot review counts separate from successful execution", () => {
    const captureSummary = {
      captured: 1,
      pending: 1,
      accepted: 0,
      missing: 0,
      issue: 0,
      needMoreEvidence: 0,
    };
    const items = [1, 2].map((id) =>
      run({
        id: String(id),
        title: "Capture",
        phase: "completed",
        outcome: "passed",
        queuedAt: id,
        batchId: "plan",
        captureSummary,
      }),
    );
    const result = collapsePlanResultRows(items)[0]!;
    expect(result.outcome).toBe("passed");
    expect(screenshotReviewLabel(result.captureSummary)).toBe("2 to review");
    expect(
      collapsePlanResultRows([
        ...items,
        run({ id: "unknown", title: "Unknown", phase: "completed", queuedAt: 3, batchId: "plan" }),
      ])[0]?.captureSummary,
    ).toBeUndefined();
  });

  it("does not retain a representative pass while another run is still active", () => {
    const rows = collapsePlanResultRows([
      run({
        id: "done",
        title: "Home",
        batchId: "active-plan",
        phase: "completed",
        outcome: "passed",
        queuedAt: 1,
      }),
      run({
        id: "active",
        title: "Settings",
        batchId: "active-plan",
        phase: "running",
        queuedAt: 2,
      }),
    ]);
    expect(rows[0]?.phase).toBe("running");
    expect(rows[0]?.outcome).toBeUndefined();
    expect(planResultListCause(rows[0]!)).toBe("In progress");
  });

  it("collapses run Across cells onto one plan Result that opens the grid", () => {
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

  it("does not call an Infra plan a product pass or a product failure", () => {
    const rows = collapsePlanResultRows(
      Array.from({ length: 8 }, (_, index) =>
        run({
          id: `run-judge-${index}`,
          title: "Grok.com logged-out judged chrome · logged-out · Settings",
          appName: "Grok.com daily",
          phase: "failed",
          outcome: "harness-failure",
          queuedAt: index + 1,
          batchId: "batch-judged",
        }),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("harness-failure");
    expect(rows[0]?.outcome).not.toBe("product-failure");
    expect(planResultListCause(rows[0]!)).toBe("Could not complete");
    expect(planResultListCause(rows[0]!)).not.toBe("Failed");
  });

  it("one passed cell plus Infra cells stays Incomplete / harness, not a product pass", () => {
    const rows = collapsePlanResultRows([
      run({
        id: "run-passed",
        title: "Open grok.com logged-out",
        appName: "Grok.com daily",
        phase: "completed",
        outcome: "passed",
        queuedAt: 1,
        batchId: "batch-incomplete",
      }),
      ...Array.from({ length: 7 }, (_, index) =>
        run({
          id: `run-infra-${index}`,
          title: "Judged chrome",
          appName: "Grok.com daily",
          phase: "failed",
          outcome: "harness-failure",
          queuedAt: index + 2,
          batchId: "batch-incomplete",
        }),
      ),
    ]);
    expect(rows[0]?.outcome).toBe("harness-failure");
    expect(planResultListCause(rows[0]!)).toBe("Could not complete");
  });

  it("uses the canonical review classification for a completed pending-review cell", () => {
    const rows = collapsePlanResultRows([
      run({
        id: "run-pending-review",
        title: "Capture Settings",
        phase: "completed",
        outcome: "uncertain",
        queuedAt: 1,
        batchId: "batch-review",
      }),
    ]);
    expect(rows[0]?.phase).toBe("completed");
    expect(rows[0]?.outcome).toBe("uncertain");
    expect(planResultListCause(rows[0]!)).toBe("Needs review");
  });

  it("does not turn an all-cancelled plan into a successful result", () => {
    const rows = collapsePlanResultRows([
      run({
        id: "run-cancelled",
        title: "Cancelled test",
        phase: "cancelled",
        outcome: "cancelled",
        queuedAt: 1,
        batchId: "batch-cancelled",
      }),
    ]);
    expect(rows[0]?.phase).toBe("cancelled");
    expect(rows[0]?.outcome).toBe("cancelled");
    expect(planResultListCause(rows[0]!)).toBe("Cancelled");
  });

  it("keeps a mixed plan as a product failure when any cell is a product issue", () => {
    const rows = collapsePlanResultRows([
      run({
        id: "run-ok",
        title: "Open grok.com",
        appName: "Grok.com daily",
        phase: "completed",
        outcome: "passed",
        queuedAt: 1,
        batchId: "batch-mixed",
      }),
      run({
        id: "run-infra",
        title: "Settings judged",
        appName: "Grok.com daily",
        phase: "failed",
        outcome: "harness-failure",
        queuedAt: 2,
        batchId: "batch-mixed",
      }),
      run({
        id: "run-fail",
        title: "Send hello",
        appName: "Grok.com daily",
        phase: "failed",
        outcome: "product-failure",
        queuedAt: 3,
        batchId: "batch-mixed",
      }),
    ]);
    expect(rows[0]?.outcome).toBe("product-failure");
    expect(planResultListCause(rows[0]!)).toBe("Failed");
  });

  it("keeps a plan Result failed when any cell failed", () => {
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

  it("uses the saved plan name from the job title, not a generic app Result", () => {
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
