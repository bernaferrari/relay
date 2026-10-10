import { describe, expect, it } from "vitest";
import {
  describeTraceTitle,
  plainObservation,
  reportTraceSteps,
  storyFromJob,
  storyFromReport,
} from "./run-story";

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
    expect(describeTraceTitle("Run saved test")).toBeUndefined();
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

  it("shows frozen pending test steps and follows exact execution provenance", () => {
    const frozen = {
      recipeSnapshot: {
        id: "root",
        steps: [
          { kind: "module", id: "open-wrapper", check: { id: "open", title: "Open Settings" } },
          {
            kind: "module",
            id: "check-wrapper",
            check: { id: "check", title: "Check Appearance" },
          },
        ],
      },
      artifacts: [
        {
          kind: "app-map-test-plan",
          data: {
            rootRecipeId: "root",
            stepProvenance: [{ recipeId: "child", recipeStepId: "tap", testStepId: "open" }],
          },
        },
      ],
    };
    expect(storyFromJob(frozen).steps.map((step) => [step.title, step.state])).toEqual([
      ["Open Settings", "pending"],
      ["Check Appearance", "pending"],
    ]);
    const traces = [
      {
        id: "wrapper",
        recipeId: "root",
        recipeStepId: "open-wrapper",
        title: "Run saved test",
        status: "running",
      },
      {
        id: "tap",
        recipeId: "child",
        recipeStepId: "tap",
        title: 'Tap label "Settings"',
        status: "ok",
      },
      {
        id: "foreign",
        recipeId: "other-child",
        recipeStepId: "tap",
        title: 'Tap label "Settings"',
        status: "ok",
      },
    ];
    const during = storyFromJob({ ...frozen, status: "running", steps: traces }).steps;
    expect(during[0]).toMatchObject({ id: "open", state: "running", actions: [{ id: "tap" }] });
    expect(during[1]).toMatchObject({ id: "check", state: "pending", actions: [] });
    expect(during[2]).toMatchObject({ id: "finish", actions: [{ id: "foreign" }] });
    const next = storyFromJob({
      ...frozen,
      steps: [
        { ...traces[0], status: "ok" },
        traces[1],
        {
          id: "check",
          recipeId: "root",
          recipeStepId: "check-wrapper",
          title: "Run saved test",
          status: "running",
        },
      ],
    }).steps;
    expect(next.map((step) => step.state)).toEqual(["passed", "running"]);
    const wrongPlan = {
      ...frozen,
      artifacts: [
        {
          kind: "app-map-test-plan",
          data: {
            rootRecipeId: "another-root",
            stepProvenance: [{ recipeId: "child", recipeStepId: "tap", testStepId: "open" }],
          },
        },
      ],
    };
    expect(storyFromJob({ ...wrongPlan, steps: [traces[1]] }).steps[0]!.actions).toEqual([]);
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

describe("plainObservation", () => {
  it("drops runner prefixes from judge output", () => {
    expect(plainObservation("visual assertion: The badge shows 0.")).toBe("The badge shows 0.");
    expect(plainObservation("judge uncertain: blurry screenshot")).toBe(
      "Not sure: blurry screenshot",
    );
  });
});

describe("engine internals", () => {
  it("never shows device plumbing or raw coordinates as steps", () => {
    expect(describeTraceTitle("Wait for identifier com.touchtype.swiftkey:id/keyboard")).toEqual({
      kind: "verify",
      label: "Keyboard opens",
    });
    expect(
      describeTraceTitle("Reach identifier com.android.systemui:id/status_bar"),
    ).toBeUndefined();
    expect(describeTraceTitle("Tap point (351, 1437)")).toEqual({
      kind: "tap",
      label: "Tap the recorded spot",
    });
  });

  it("keeps nested taps with the step in progress instead of a separate group", () => {
    const steps = storyFromReport({
      timeline: [
        { id: "a", index: 0, title: "Reach Home", state: "passed", evidenceCount: 0 },
        { id: "b", index: 1, title: "Tap point (10, 20)", state: "passed", evidenceCount: 0 },
        { id: "c", index: 2, title: 'Tap label "Menu"', state: "passed", evidenceCount: 0 },
      ],
      stepEvidence: [0].map((traceStepIndex) => ({
        schemaVersion: 1 as const,
        testStepId: "open-menu",
        recipeId: "r",
        recipeStepId: "s",
        traceStepId: "t0",
        traceStepIndex,
        occurrence: 1,
        evidence: { framePaths: [], eventSequences: [], artifactKinds: [] },
      })),
      stepTitles: { "open-menu": "Open the menu" },
    });
    expect(steps.map((step) => [step.title, step.actions.length])).toEqual([["Open the menu", 3]]);
  });
});
