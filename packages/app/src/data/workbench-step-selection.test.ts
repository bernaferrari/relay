import { describe, expect, it } from "vitest";
import { currentTestOutlineCopy, historicalRunCaption } from "./workbench-step-selection";

describe("workbench step selection", () => {
  it("labels current Test steps separately from a historical Run", () => {
    expect(currentTestOutlineCopy({ stepCount: 4, viewingHistoricalRun: true })).toEqual({
      title: "4 steps",
      hint: "",
    });
    expect(currentTestOutlineCopy({ stepCount: 1, viewingHistoricalRun: false })).toEqual({
      title: "1 step",
    });
  });

  it("keeps historical identity visible when the executed revision is known", () => {
    expect(historicalRunCaption({ runId: "run-184", sourceRevision: "11" })).toBe(
      "Viewing historical Run run-184, which executed revision 11. Current Test steps stay selected separately.",
    );
  });
});
