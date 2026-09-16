import { describe, expect, it } from "vitest";
import { describeCoverageStepReason } from "@relay/protocol";
import { projectRunReport } from "./run-report-projection";
import { initialRunStep } from "./run-timeline-selection";

describe("readable run timeline", () => {
  const raw = {
    artifacts: [
      {
        kind: "app-map-combine-cell-execution-intent",
        data: { child: { recipeGraph: { authored: {} } } },
      },
    ],
    steps: [
      {
        id: "setup",
        recipeId: "wrapper",
        title: "Open browser",
        status: "ok",
        frames: [{ path: "setup.png" }],
      },
      { id: "branch", recipeId: "wrapper", title: "Branch when {{generated}}", status: "ok" },
      {
        id: "test",
        recipeId: "authored",
        title: "Screenshot · Cart",
        status: "ok",
        frames: [{ path: "cart.png" }],
      },
    ],
  };
  it("distinguishes setup from authored evidence and suppresses successful machinery", () => {
    const report = projectRunReport("run", raw, {});
    expect(report.timeline.map((step) => [step.id, step.phase])).toEqual([
      ["setup", "setup"],
      ["test", "test"],
    ]);
    expect(initialRunStep(report.timeline)).toBe(1);
  });
  it("keeps a failed branch visible and selects it before successful evidence", () => {
    const report = projectRunReport(
      "run",
      {
        ...raw,
        steps: raw.steps.map((step) =>
          step.id === "branch" ? { ...step, status: "error" } : step,
        ),
      },
      {},
    );
    expect(report.timeline[initialRunStep(report.timeline)]?.id).toBe("branch");
  });
  it("does not infer a setup phase without a frozen child recipe graph", () => {
    const report = projectRunReport("run", { ...raw, artifacts: [] }, {});
    expect(report.timeline.every((step) => step.phase === undefined)).toBe(true);
    expect(initialRunStep([])).toBe(0);
  });
});

it("retains a parent capture when its nested wait has no screenshot", () => {
  const result = projectRunReport(
    "run",
    {
      steps: [
        { id: "parent", title: "Run saved Test", status: "ok", frames: [{ path: "welcome.png" }] },
        { id: "wait", title: "Sleep 10000ms", status: "ok", frames: [] },
      ],
    },
    {},
  );
  expect(result.timeline[initialRunStep(result.timeline)]?.framePaths).toEqual(["welcome.png"]);
  expect(result.timeline[0]?.title).toBe("Captured result");
});

it("omits skipped conditional targets from the action timeline", () => {
  const result = projectRunReport(
    "run",
    {
      steps: [
        {
          id: "skipped",
          title: 'Tap button label "Business"',
          status: "ok",
          log: 'conditional tap: skipped — button label "Business" is absent',
          frames: [{ path: "unchanged.png" }],
        },
        {
          id: "actual",
          title: 'Tap button label "Empresarial"',
          status: "ok",
          frames: [{ path: "business.png" }],
        },
      ],
    },
    {},
  );
  expect(result.timeline.map((step) => step.id)).toEqual(["actual"]);
});

it("shows inspect leftover skip instead of claiming the opener tap executed", () => {
  const skipTitle = describeCoverageStepReason("inspect-setup-skipped");
  const result = projectRunReport(
    "run",
    {
      steps: [
        {
          id: "skipped-opener",
          title: skipTitle,
          status: "ok",
          log: skipTitle,
          frames: [{ path: "settings.png" }],
        },
        {
          id: "capture",
          title: "Settings panel",
          status: "ok",
          frames: [{ path: "settings.png" }],
        },
      ],
    },
    {},
  );
  expect(result.timeline.map((step) => [step.id, step.title])).toEqual([
    ["skipped-opener", skipTitle],
    ["capture", "Settings panel"],
  ]);
  expect(result.timeline.some((step) => /tap/iu.test(step.title))).toBe(false);
});

it("shows a required transition opener as executed when leftover chrome is still present", () => {
  const executedTitle = describeCoverageStepReason("transition-executed");
  const result = projectRunReport(
    "run",
    {
      steps: [
        {
          id: "opener",
          title: executedTitle,
          status: "ok",
          log: executedTitle,
          frames: [{ path: "after-tap.png" }],
        },
      ],
    },
    {},
  );
  expect(result.timeline.map((step) => [step.id, step.title])).toEqual([["opener", executedTitle]]);
  expect(result.timeline[0]?.title).not.toBe(describeCoverageStepReason("inspect-setup-skipped"));
});

it("does not repeat a wrapper capture when the same authored step has visible capture evidence", () => {
  const result = projectRunReport(
    "run",
    {
      steps: [
        { id: "parent", title: "Run saved Test", status: "ok", frames: [{ path: "parent.png" }] },
        {
          id: "capture",
          title: "Screenshot · Individual",
          status: "ok",
          frames: [{ path: "individual.png" }],
        },
      ],
      testStepEvidence: ["parent", "capture"].map((id, index) => ({
        schemaVersion: 1,
        testStepId: "individual",
        recipeId: "recipe",
        recipeStepId: id,
        traceStepId: id,
        traceStepIndex: index,
        occurrence: index + 1,
        evidence: {
          framePaths: [id === "parent" ? "parent.png" : "individual.png"],
          eventSequences: [],
          artifactKinds: [],
        },
      })),
    },
    {},
  );
  expect(result.timeline.map((step) => step.id)).toEqual(["capture"]);
});
