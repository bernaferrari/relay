import { describe, expect, it } from "vitest";
import {
  canKeepVisualBaseline,
  leaveVisualPendingLabel,
  visualIgnoreCopy,
  visualPendingCopy,
} from "./run-review-controls";

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

  it("names Library chrome sandwich without implying a feed survey", () => {
    expect(
      visualIgnoreCopy({
        code: "VISUAL_BASELINE_MISSING",
        policy: {
          regions: [{ mode: "ignore", name: "library chrome sandwich" }],
        },
      }),
    ).toBe(
      "1 ignore region (library chrome sandwich). One viewport of top and bottom chrome stays compared. Do not survey the feed.",
    );
  });

  it("leaves a missing baseline pending and hides Keep baseline", () => {
    expect(visualPendingCopy("VISUAL_BASELINE_MISSING")).toContain("stays pending");
    expect(visualPendingCopy("VISUAL_BASELINE_MISSING")).toContain("Agents cannot approve");
    expect(canKeepVisualBaseline("VISUAL_BASELINE_MISSING")).toBe(false);
    expect(leaveVisualPendingLabel("VISUAL_BASELINE_MISSING")).toBe("Leave pending");
    expect(canKeepVisualBaseline("VISUAL_CHANGED")).toBe(true);
    expect(leaveVisualPendingLabel("VISUAL_CHANGED")).toBe("Retry later");
    expect(visualPendingCopy("VISUAL_CHANGED")).toContain("Agents cannot approve");
  });
});
