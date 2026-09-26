import { describe, expect, it } from "vitest";
import { describeTraceTitle, storyFromJob, storyFromReport } from "./run-story";

describe("run story", () => {
  it("says what the engine did in plain words", () => {
    expect(describeTraceTitle('Tap label "Settings"')).toEqual({
      kind: "tap",
      label: "Tap “Settings”",
    });
    expect(describeTraceTitle("Reach Workspace settings")).toEqual({
      kind: "verify",
      label: "On Workspace settings",
    });
    expect(describeTraceTitle("Capture for review · step:open:Settings")).toEqual({
      kind: "screenshot",
      label: "Screenshot · Settings",
    });
    expect(describeTraceTitle('Type "hello" into Message')).toEqual({
      kind: "type",
      label: "Type “hello”",
    });
    expect(describeTraceTitle("Run saved Test")).toBeUndefined();
  });

  it("groups actions under the authored step and keeps the rest as Finish", () => {
    const steps = storyFromReport({
      timeline: [
        { id: "a", index: 0, title: "Run saved Test", state: "passed", evidenceCount: 0 },
        {
          id: "b",
          index: 1,
          title: 'Tap label "Settings"',
          state: "passed",
          durationMs: 100,
          evidenceCount: 1,
          framePaths: ["frames/002.png"],
        },
        {
          id: "c",
          index: 2,
          title: "Reach Settings",
          state: "failed",
          durationMs: 50,
          evidenceCount: 0,
        },
        { id: "d", index: 3, title: "Screenshot · final:Test", state: "passed", evidenceCount: 1 },
      ],
      stepEvidence: [1, 2].map((traceStepIndex) => ({
        schemaVersion: 1 as const,
        testStepId: "open-settings",
        recipeId: "r",
        recipeStepId: "s",
        traceStepId: `t${traceStepIndex}`,
        traceStepIndex,
        occurrence: 1,
        evidence: { framePaths: [], eventSequences: [], artifactKinds: [] },
      })),
      stepTitles: { "open-settings": "Open settings" },
    });
    expect(steps.map((step) => [step.title, step.state, step.durationMs])).toEqual([
      ["Open settings", "failed", 150],
      ["Finish", "passed", 0],
    ]);
    expect(steps[0]!.actions[0]!.framePath).toBe("frames/002.png");
  });

  it("streams a live job as one running step that follows the newest frame", () => {
    const live = storyFromJob({
      title: "Checkout",
      status: "running",
      steps: [
        {
          id: "1",
          title: 'Tap label "Cart"',
          status: "ok",
          durationMs: 90,
          frames: [{ path: "frames/001.png" }],
        },
        { id: "2", title: "Reach Cart", status: "running" },
      ],
      frames: [{ path: "frames/001.png" }, { path: "frames/002.png" }],
    });
    expect(live.latestFrame).toBe("frames/002.png");
    expect(live.steps[0]).toMatchObject({ title: "Checkout", state: "running" });
    expect(live.steps[0]!.actions.map((action) => action.state)).toEqual(["passed", "running"]);
  });
});
