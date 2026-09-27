import { describe, expect, it } from "vitest";
import { replayCompletionAction, replayPauseLabel, replayStopLabel } from "./run-replay";

describe("replay completion", () => {
  it("offers the result without treating a finished replay as a route change", () => {
    expect(replayCompletionAction("ok", "run-1")).toBe("offer-result");
    expect(replayCompletionAction("running", "run-1")).toBe("stay");
    expect(replayCompletionAction("ok", undefined)).toBe("stay");
  });

  it("says the person has control only when the pause is waiting for them", () => {
    expect(replayPauseLabel("paused", true)).toBe("Paused · You have control");
    expect(replayPauseLabel("paused", false)).toBe(
      "Replay paused; waiting for the current operation to continue.",
    );
    expect(replayPauseLabel("running", true)).toBe(
      "Automation running · Relay controls the target",
    );
  });

  it("names takeover only while automation is running", () => {
    expect(replayStopLabel("running", false)).toBe("Stop automation");
    expect(replayStopLabel("paused", false)).toBe("Stop replay");
    expect(replayStopLabel("running", true)).toBe("Stopping…");
  });


});
