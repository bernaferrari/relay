import { describe, expect, it } from "vitest";
import { describeTraceTitle, reportTraceSteps, storyFromJob, storyFromReport } from "./run-story";

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

  it("carries the proven layout failure through saved and live stories with exact trace identity", () => {
    const first = { identifier: "team-seats" };
    const second = { identifier: "save-settings" };
    const raw = {
      title: "Settings layout",
      status: "error",
      steps: [
        {
          id: "layout-trace",
          index: 4,
          title: "Check layout: identifier team-seats does not overlap identifier save-settings",
          status: "error",
          frames: [{ path: "layout-failure.png" }],
        },
      ],
      artifacts: [
        {
          kind: "command-attempt",
          data: {
            stepId: "layout-trace",
            command: { kind: "assert-layout", relation: "non-overlap", first, second },
          },
        },
        {
          kind: "layout-assertion",
          data: {
            relation: "non-overlap",
            first,
            second,
            passed: false,
            overlap: { x: 1, y: 2, width: 30, height: 44 },
            error:
              "layout assertion: identifier team-seats overlaps identifier save-settings by 30×44 px",
          },
        },
        {
          kind: "ui-tree",
          data: {
            stepId: "layout-trace",
            phase: "after",
            nodes: [
              { identifier: "team-seats", label: "Team seats" },
              { identifier: "save-settings", label: "Save" },
            ],
          },
        },
      ],
    };
    const saved = storyFromReport({
      timeline: reportTraceSteps(raw),
      stepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "settings-step",
          recipeId: "r",
          recipeStepId: "layout",
          traceStepId: "layout-trace",
          traceStepIndex: 4,
          occurrence: 1,
          evidence: {
            framePaths: ["layout-failure.png"],
            eventSequences: [],
            artifactKinds: ["layout-assertion"],
          },
        },
      ],
      stepTitles: { "settings-step": "Check settings layout" },
    });
    expect(saved[0]).toMatchObject({
      id: "settings-step",
      title: "Check settings layout",
      state: "failed",
    });
    const expected = {
      id: "layout-trace",
      label: "Check Team seats and Save do not overlap",
      state: "failed",
      framePath: "layout-failure.png",
      failure: { summary: "Team seats and Save overlap." },
    };
    expect(saved[0]?.actions[0]).toMatchObject(expected);
    expect(storyFromJob(raw).steps[0]?.actions[0]).toMatchObject(expected);
    expect(describeTraceTitle(raw.steps[0]!.title)?.label).toBe("Check elements do not overlap");
  });
});
