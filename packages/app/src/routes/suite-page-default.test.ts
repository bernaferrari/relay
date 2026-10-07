import { describe, expect, it } from "vitest";
import { defaultPlanExecutionMode, planRunCountLabel } from "./suite-page";

describe("plan run defaults", () => {
  it("starts with one setup before someone chooses to run every combination", () => {
    expect(defaultPlanExecutionMode).toBe("pilot");
  });

  it("describes combinations without claiming each is a separate device setup", () => {
    expect(planRunCountLabel({ blockers: 0, plannedCases: 1, executionMode: "all" })).toBe(
      "Every test runs once",
    );
    expect(planRunCountLabel({ blockers: 0, plannedCases: 9, executionMode: "all" })).toBe(
      "Every test runs with 9 combinations",
    );
    expect(planRunCountLabel({ blockers: 0, plannedCases: 9, executionMode: "pilot" })).toBe(
      "One combination first, then 8 more when you continue",
    );
    expect(planRunCountLabel({ blockers: 1, plannedCases: 9, executionMode: "all" })).toBe(
      "Setup needed before running",
    );
  });
});
