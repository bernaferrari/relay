import { describe, expect, it } from "vitest";
import { defaultPlanExecutionMode, planRunCountLabel } from "./suite-page";

describe("plan run defaults", () => {
  it("runs every test when someone presses Run all", () => {
    expect(defaultPlanExecutionMode).toBe("all");
  });

  it("describes the run in tests and setups, not cases", () => {
    expect(planRunCountLabel({ blockers: 0, plannedCases: 1, executionMode: "all" })).toBe(
      "Every test runs once",
    );
    expect(planRunCountLabel({ blockers: 0, plannedCases: 9, executionMode: "all" })).toBe(
      "Every test runs on 9 setups",
    );
    expect(planRunCountLabel({ blockers: 0, plannedCases: 9, executionMode: "pilot" })).toBe(
      "One setup first, then 8 more when you continue",
    );
    expect(planRunCountLabel({ blockers: 1, plannedCases: 9, executionMode: "all" })).toBe(
      "Setup needed before running",
    );
  });
});
