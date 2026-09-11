import { describe, expect, it } from "vitest";
import { projectRunReport } from "./run-report-projection";
import { initialRunStep } from "./run-timeline-selection";

describe("readable run timeline", () => {
  const raw = {
    artifacts: [
      {
        kind: "app-map-combine-cell-execution-intent",
        data: { child: { recipeGraph: { authored: {} } } },
      },
    ],
    steps: [
      {
        id: "setup",
        recipeId: "wrapper",
        title: "Open browser",
        status: "ok",
        frames: [{ path: "setup.png" }],
      },
      { id: "branch", recipeId: "wrapper", title: "Branch when {{generated}}", status: "ok" },
      {
        id: "test",
        recipeId: "authored",
        title: "Screenshot · Cart",
        status: "ok",
        frames: [{ path: "cart.png" }],
      },
    ],
  };
  it("distinguishes setup from authored evidence and suppresses successful machinery", () => {
    const report = projectRunReport("run", raw, {});
    expect(report.timeline.map((step) => [step.id, step.phase])).toEqual([
      ["setup", "setup"],
      ["test", "test"],
    ]);
    expect(initialRunStep(report.timeline)).toBe(1);
  });
  it("keeps a failed branch visible and selects it before successful evidence", () => {
    const report = projectRunReport(
      "run",
      {
        ...raw,
        steps: raw.steps.map((step) =>
          step.id === "branch" ? { ...step, status: "error" } : step,
        ),
      },
      {},
    );
    expect(report.timeline[initialRunStep(report.timeline)]?.id).toBe("branch");
  });
  it("does not infer a setup phase without a frozen child recipe graph", () => {
    const report = projectRunReport("run", { ...raw, artifacts: [] }, {});
    expect(report.timeline.every((step) => step.phase === undefined)).toBe(true);
    expect(initialRunStep([])).toBe(0);
  });
});
