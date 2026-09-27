import { describe, expect, it } from "vitest";
import { failureTitle, resultHeading } from "./run-report-formatters";

describe("run result wording", () => {
  it("uses outcome-specific headings instead of a generic Failed label", () => {
    expect(resultHeading("passed")).toBe("Checks passed");
    expect(resultHeading("product-failure")).toBe("Check failed");
    expect(resultHeading("harness-failure")).toBe("Could not complete");
    expect(resultHeading("uncertain")).toBe("Outcome not confirmed");
    expect(resultHeading("cancelled")).toBe("Cancelled");
    expect(resultHeading(undefined)).toBe("Incomplete evidence");
  });

  it("does not infer an app timeout from arbitrary error text", () => {
    expect(failureTitle("XCTest snapshot timeout while collecting evidence")).toBe(
      "XCTest snapshot timeout while collecting evidence",
    );
    expect(failureTitle("page.goto timed out", "Browser connection")).toBe("Browser connection");
  });
});
