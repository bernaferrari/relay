import { describe, expect, it } from "vitest";
import { visualIgnoreCopy } from "./run-review-controls";

describe("visualIgnoreCopy", () => {
  it("warns when a missing baseline would compare the reply body", () => {
    expect(visualIgnoreCopy({ code: "VISUAL_BASELINE_MISSING", policy: { regions: [] } })).toBe(
      "No ignore regions. Dynamic reply bodies will be compared if you approve this baseline.",
    );
  });

  it("names ignore regions without implying Confirm/Reject accepted them", () => {
    expect(
      visualIgnoreCopy({
        code: "VISUAL_BASELINE_MISSING",
        policy: {
          regions: [
            { mode: "ignore", name: "reply body" },
            { mode: "ignore", name: "reply body" },
            { mode: "compare", name: "header" },
          ],
        },
      }),
    ).toBe("2 ignore regions (reply body). Chrome stays compared.");
  });
});
