import { describe, expect, it } from "vitest";
import { defaultPlanExecutionMode, planRunCountLabel, planRunDescription } from "./suite-page";

describe("plan run default", () => {
  it("starts with one case instead of every configuration", () => {
    expect(defaultPlanExecutionMode).toBe("pilot");
  });

  it("shows one of the planned cases until every case is chosen", () => {
    expect(planRunCountLabel({ blockers: 0, plannedCases: 9, executionMode: "pilot" })).toBe(
      "This run: 1 of 9 cases",
    );
    expect(planRunCountLabel({ blockers: 0, plannedCases: 9, executionMode: "all" })).toBe(
      "This run: 9 cases",
    );
    expect(planRunCountLabel({ blockers: 1, plannedCases: 9, executionMode: "all" })).toBe(
      "Needs attention",
    );
  });

  it("describes one case until every case is chosen", () => {
    expect(planRunDescription("Acme", "pilot")).toBe(
      "Acme. Choose where to run, then run one case.",
    );
    expect(planRunDescription(undefined, "all")).toBe(
      "Choose where to run, then run every case.",
    );
  });


});
