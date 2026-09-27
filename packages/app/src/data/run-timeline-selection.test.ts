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
          title: 'Tap button label"Business"',
          status: "ok",
          log: 'conditional tap: skipped — button label"Business" is absent',
          frames: [{ path: "unchanged.png" }],
        },
        {
          id: "actual",
          title: 'Tap button label"Empresarial"',
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

it("dest-end Observe is dest wait-for, not leftover Run saved Test last-frame", () => {
  const result = projectRunReport(
    "dest-end-observe",
    {
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-observe:Observe",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-observe-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      steps: [
        {
          id: "trace-module",
          index: 4,
          title: "Run saved Test",
          status: "ok",
          frames: [{ path: "frames/004.png", caption: "after · Run saved Test" }],
        },
        {
          id: "trace-wait",
          index: 6,
          title: 'Wait for label"What should we explore?"',
          status: "ok",
          frames: [],
        },
        {
          id: "trace-dest",
          index: 8,
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe" }],
        },
      ],
      testStepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "step-observe",
          recipeId: "observe-flow",
          recipeStepId: "relay-test-step-observe-dest",
          traceStepId: "trace-dest",
          traceStepIndex: 8,
          occurrence: 5,
          evidence: {
            framePaths: ["frames/003.png"],
            eventSequences: [],
            artifactKinds: ["capture-review"],
          },
        },
      ],
    },
    {},
  );
  expect(result.timeline.find((step) => step.id === "trace-dest")).toMatchObject({
    title: "Observe",
    framePaths: ["frames/003.png"],
  });
  expect(result.timeline.some((step) => step.title === "Captured result")).toBe(false);
  expect(result.timeline.some((step) => step.framePaths?.includes("frames/004.png"))).toBe(false);
  expect(result.timeline[initialRunStep(result.timeline)]?.framePaths).toEqual(["frames/003.png"]);
});

it("dest-end Observe drops leftover Transition executed / Inspect setup skipped beside dest", () => {
  const executedTitle = describeCoverageStepReason("transition-executed");
  const skipTitle = describeCoverageStepReason("inspect-setup-skipped");
  const result = projectRunReport(
    "dest-end-leftover-wrappers",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-observe:Observe",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-observe-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      steps: [
        {
          id: "trace-transition",
          index: 2,
          title: executedTitle,
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [{ path: "frames/002.png", caption: "after · Transition executed" }],
        },
        {
          id: "trace-skip",
          index: 3,
          title: skipTitle,
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [
            {
              path: "frames/004.png",
              caption: "after · Inspect setup skipped — already on this view",
            },
          ],
        },
        {
          id: "trace-dest",
          index: 8,
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe" }],
        },
      ],
    },
    { channels: { screenshot: { entries: 3 } } },
  );
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(result.timeline[0]?.title).toBe("Observe");
  expect(result.firstEvidence?.label).toBe("Observe");
  expect(result.firstEvidence?.label).not.toBe(executedTitle);
  expect(result.firstEvidence?.label).not.toBe(skipTitle);
  const shotTitles = result.evidence
    .find((section) => section.id === "screenshot")
    ?.items.map((item) => item.title);
  expect(shotTitles).toHaveLength(1);
  expect(shotTitles?.[0]).toMatch(/Observe/u);
  expect(
    shotTitles?.some((title) => /Transition executed|Inspect setup skipped/u.test(title ?? "")),
  ).toBe(false);
});

it("dest-end Observe drops empty-frame Inspect setup skipped siblings beside dest", () => {
  const skipTitle = describeCoverageStepReason("inspect-setup-skipped");
  const result = projectRunReport(
    "dest-end-empty-inspect-skip",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-action:Grok logo from Imagine signed-in",
            framePath: "frames/005.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-logo-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      steps: [
        {
          id: "trace-skip-capture",
          index: 1,
          title: skipTitle,
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [
            { path: "frames/001.png", caption: 'before · Tap label "Imagine"' },
            {
              path: "frames/002.png",
              caption: "after · Inspect setup skipped — already on this view",
            },
          ],
        },
        {
          id: "trace-skip-empty",
          index: 2,
          title: skipTitle,
          status: "ok",
          log: skipTitle,
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-skip-empty-2",
          index: 3,
          title: skipTitle,
          status: "ok",
          log: skipTitle,
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-dest",
          index: 4,
          title: "Capture for review · step:step-action:Grok logo from Imagine signed-in",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [
            {
              path: "frames/005.png",
              caption: "step:step-action:Grok logo from Imagine signed-in",
            },
          ],
        },
      ],
    },
    { channels: { screenshot: { entries: 1 } } },
  );
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(result.timeline.map((step) => step.title)).toEqual(["Grok logo from Imagine signed-in"]);
  expect(result.timeline.some((step) => step.title === skipTitle)).toBe(false);
  expect(result.firstEvidence?.label).toBe("Grok logo from Imagine signed-in");
});

it("unphased Observe drops opener Tap Captured result beside leftover Transition", () => {
  const executedTitle = describeCoverageStepReason("transition-executed");
  const result = projectRunReport(
    "unphased-opener-tap-timeline",
    {
      outcome: "passed",
      artifacts: [],
      frames: [
        { path: "frames/001.png", caption: "before · Tap identifier sidebar.open.button" },
        { path: "frames/002.png", caption: "after · Transition executed" },
        { path: "frames/003.png", caption: "Observe" },
      ],
      steps: [
        {
          id: "trace-tap",
          index: 1,
          title: "before · Tap identifier sidebar.open.button",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [
            {
              path: "frames/001.png",
              caption: "before · Tap identifier sidebar.open.button",
            },
          ],
        },
        {
          id: "trace-transition",
          index: 2,
          title: executedTitle,
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [{ path: "frames/002.png", caption: "after · Transition executed" }],
        },
        {
          id: "trace-dest",
          index: 3,
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [{ path: "frames/003.png", caption: "Observe" }],
        },
      ],
    },
    { channels: { screenshot: { entries: 3 } } },
  );
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(result.timeline.map((step) => step.title)).toEqual(["Observe"]);
  expect(result.timeline.some((step) => step.title === "Captured result")).toBe(false);
  expect(result.firstEvidence?.label).toBe("Observe");
  expect(
    result.evidence.find((section) => section.id === "screenshot")?.items.map((item) => item.id),
  ).toEqual(["frames/003.png"]);
});

it("dest-end Observe drops opener Tap from shots when leftover wrappers are empty-frame only", () => {
  const executedTitle = describeCoverageStepReason("transition-executed");
  const skipTitle = describeCoverageStepReason("inspect-setup-skipped");
  const result = projectRunReport(
    "dest-end-empty-leftover-opener-shots",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Observe",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-observe-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      frames: [
        { path: "frames/001.png", caption: 'before · Tap label "Home page"' },
        { path: "frames/003.png", caption: "Observe" },
      ],
      steps: [
        {
          id: "trace-tap",
          index: 1,
          title: 'before · Tap label "Home page"',
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [{ path: "frames/001.png", caption: 'before · Tap label "Home page"' }],
        },
        {
          id: "trace-skip-empty",
          index: 2,
          title: skipTitle,
          status: "ok",
          log: skipTitle,
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-transition-empty",
          index: 3,
          title: executedTitle,
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-dest",
          index: 4,
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [{ path: "frames/003.png", caption: "Observe" }],
        },
      ],
    },
    { channels: { screenshot: { entries: 2 } } },
  );
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(result.timeline.some((step) => step.title === "Captured result")).toBe(false);
  expect(
    result.evidence.find((section) => section.id === "screenshot")?.items.map((item) => item.id),
  ).toEqual(["frames/003.png"]);
  expect(
    result.evidence
      .find((section) => section.id === "screenshot")
      ?.items.some((item) => /Tap|Screenshot 1/u.test(item.title ?? "")),
  ).toBe(false);
});

it("dest-end firstEvidence is Observe, not prelude Expected screen content was visible", () => {
  const result = projectRunReport(
    "dest-end-first-evidence",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-observe:Observe",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-observe-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      steps: [
        {
          id: "trace-check",
          index: 0,
          title: "check identifier sidebar-header-search visible",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-sign-in",
          index: 1,
          title: 'check "Sign in" gone',
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-dest",
          index: 2,
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe" }],
        },
      ],
    },
    { channels: { screenshot: { entries: 1 } } },
  );
  expect(result.firstEvidence?.label).toBe("Observe");
  expect(result.firstEvidence?.label).not.toBe("Expected screen content was visible");
  expect(result.firstEvidence?.label).not.toBe('check "Sign in" gone');
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(result.timeline.map((step) => step.title)).toEqual(["Observe"]);
  expect(
    result.timeline.some(
      (step) =>
        step.title === "Expected screen content was visible" ||
        step.title === 'check "Sign in" gone',
    ),
  ).toBe(false);
});

it("dest-end Observe timeline and shots drop prelude Reach / Land when dest-phase is stamped", () => {
  const result = projectRunReport(
    "dest-end-prelude-reach-land-shots",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-observe:Observe",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-observe-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      frames: [
        { path: "frames/001.png", caption: "after · Reach Signed-in home" },
        {
          path: "frames/002.png",
          caption: "step:step-expect-signed-in-home:Land on signed-in home",
        },
        { path: "frames/004.png", caption: "after · Run saved Test" },
        { path: "frames/003.png", caption: "step:step-observe:Observe" },
      ],
      steps: [
        {
          id: "trace-check",
          index: 0,
          title: "check identifier sidebar-header-search visible",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-sign-in",
          index: 1,
          title: 'check "Sign in" gone',
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-reach",
          index: 2,
          title: "Reach Signed-in home",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [{ path: "frames/001.png", caption: "after · Reach Signed-in home" }],
        },
        {
          id: "trace-land",
          index: 3,
          title: "Screenshot · step:step-expect-signed-in-home:Land on signed-in home",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [
            {
              path: "frames/002.png",
              caption: "step:step-expect-signed-in-home:Land on signed-in home",
            },
          ],
        },
        {
          id: "trace-close",
          index: 4,
          title: "Run saved Test",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [{ path: "frames/004.png", caption: "after · Run saved Test" }],
        },
        {
          id: "trace-dest",
          index: 5,
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe" }],
        },
      ],
    },
    { channels: { screenshot: { entries: 4 } } },
  );
  expect(result.firstEvidence?.label).toBe("Observe");
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(
    result.timeline.some(
      (step) =>
        step.title === "Expected screen content was visible" ||
        step.title === 'check "Sign in" gone' ||
        step.title === "Reach Signed-in home" ||
        step.title === "Land on signed-in home",
    ),
  ).toBe(false);
  expect(
    result.evidence.find((section) => section.id === "screenshot")?.items.map((item) => item.id),
  ).toEqual(["frames/003.png"]);
});

it("dest-end Observe timeline drops prelude Wait for label / Sleep beside dest", () => {
  const result = projectRunReport(
    "dest-end-prelude-wait-sleep",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-observe:Observe",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-observe-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      frames: [
        { path: "frames/004.png", caption: "after · Run saved Test" },
        { path: "frames/003.png", caption: "step:step-observe:Observe" },
      ],
      steps: [
        {
          id: "trace-sleep",
          index: 5,
          title: "Sleep 1500ms",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-wait",
          index: 6,
          title: 'Wait for label "What should we explore?"',
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-dest",
          index: 8,
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          actions: [{ kind: "ok" }, { kind: "shot" }],
          frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe" }],
        },
      ],
      testStepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "step-observe",
          recipeId: "observe-flow",
          recipeStepId: "relay-test-step-observe-dest",
          traceStepId: "trace-dest",
          traceStepIndex: 8,
          occurrence: 5,
          evidence: {
            framePaths: ["frames/003.png"],
            eventSequences: [],
            artifactKinds: ["capture-review"],
          },
        },
      ],
    },
    {},
  );
  expect(result.firstEvidence?.label).toBe("Observe");
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(result.timeline.map((step) => step.title)).toEqual(["Observe"]);
  expect(
    result.timeline.some(
      (step) =>
        step.title === "Sleep 1500ms" || step.title === 'Wait for label "What should we explore?"',
    ),
  ).toBe(false);
});

it("dest-end timeline drops prelude Wait for text beside dest Capture for review", () => {
  const waitText =
    'Wait for text "This chat won\'t appear in your history and will not be used to train models."';
  const result = projectRunReport(
    "dest-end-prelude-wait-text",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-action:Switch to private chat signed-in",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-action-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      frames: [
        { path: "frames/004.png", caption: "after · Run saved Test" },
        {
          path: "frames/003.png",
          caption: "step:step-action:Switch to private chat signed-in",
        },
      ],
      steps: [
        {
          id: "trace-sleep",
          index: 5,
          title: "Sleep 1500ms",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-wait-text",
          index: 6,
          title: waitText,
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-dest",
          index: 7,
          title: "Capture for review · step:step-action:Switch to private chat signed-in",
          status: "ok",
          actions: [{ kind: "ok" }, { kind: "shot" }],
          frames: [
            {
              path: "frames/003.png",
              caption: "step:step-action:Switch to private chat signed-in",
            },
          ],
        },
      ],
      testStepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "step-action",
          recipeId: "private-chat-flow",
          recipeStepId: "relay-test-step-action-dest",
          traceStepId: "trace-dest",
          traceStepIndex: 7,
          occurrence: 1,
          evidence: {
            framePaths: ["frames/003.png"],
            eventSequences: [],
            artifactKinds: ["capture-review"],
          },
        },
      ],
    },
    {},
  );
  expect(result.timeline.map((step) => step.id)).toEqual(["trace-dest"]);
  expect(result.timeline.map((step) => step.title)).toEqual(["Switch to private chat signed-in"]);
  expect(result.timeline.some((step) => step.title === waitText)).toBe(false);
  expect(result.timeline.some((step) => step.title === "Sleep 1500ms")).toBe(false);
});

it("dest-end Model selector SuperGrok keeps product title, not Captured result", () => {
  const result = projectRunReport(
    "dest-end-model-selector-title",
    {
      outcome: "passed",
      evidence: {
        channels: {
          screenshot: { entries: 1 },
        },
      },
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-action:Model selector SuperGrok",
            framePath: "frames/003.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-action-dest",
            phase: "dest",
            policy: "fast",
          },
        },
      ],
      frames: [
        {
          path: "frames/001.png",
          caption: "before · Tap identifier toolbar.model.selector.button",
        },
        {
          path: "frames/002.png",
          caption: "after · Tap identifier toolbar.model.selector.button",
        },
        { path: "frames/004.png", caption: "after · Run saved Test" },
        {
          path: "frames/003.png",
          caption: "step:step-action:Model selector SuperGrok",
        },
      ],
      steps: [
        {
          id: "trace-run",
          index: 0,
          title: "Run saved Test",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [{ path: "frames/004.png", caption: "after · Run saved Test" }],
        },
        {
          id: "trace-tap",
          index: 1,
          title: "Tap identifier toolbar.model.selector.button",
          status: "ok",
          actions: [{ kind: "tap" }],
          frames: [
            {
              path: "frames/001.png",
              caption: "before · Tap identifier toolbar.model.selector.button",
            },
            {
              path: "frames/002.png",
              caption: "after · Tap identifier toolbar.model.selector.button",
            },
          ],
        },
        {
          id: "trace-wait",
          index: 2,
          title: 'Wait for label "Heavy"',
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [],
        },
        {
          id: "trace-dest",
          index: 3,
          title: "Capture for review · step:step-action:Model selector SuperGrok",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [
            {
              path: "frames/003.png",
              caption: "step:step-action:Model selector SuperGrok",
            },
          ],
        },
      ],
    },
    {},
  );
  expect(result.firstEvidence?.label).toBe("Model selector SuperGrok");
  expect(result.firstEvidence?.label).not.toBe("Captured result");
  expect(result.timeline.map((step) => step.title)).toEqual(["Model selector SuperGrok"]);
  expect(result.timeline.some((step) => step.title === "Captured result")).toBe(false);
  expect(result.timeline.some((step) => step.title === 'Wait for label "Heavy"')).toBe(false);
  const shotTitles = (
    result.evidence as readonly { items?: readonly { title?: string; id?: string }[] }[]
  )?.[0]?.items;
  expect(shotTitles?.map((item) => item.id)).toEqual(["frames/003.png"]);
  expect(shotTitles?.map((item) => item.title)).toEqual(["Model selector SuperGrok"]);
  expect(shotTitles?.some((item) => /Screenshot \d+|Captured result/u.test(item.title ?? ""))).toBe(
    false,
  );
});

it("failed dest-end firstEvidence is Capture for review, not prelude Wait for", () => {
  const result = projectRunReport(
    "dest-end-failed-wait-first-evidence",
    {
      outcome: "harness-failure",
      evidence: {
        channels: {
          screenshot: { entries: 3 },
        },
      },
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-action:Tap Expert, dismiss with Back key (not 540,400).",
            framePath: "frames/007.png",
            imageSha256: "dest-wait",
            stepId: "relay-test-step-action-dest",
          },
        },
      ],
      steps: [
        {
          id: "trace-wait",
          index: 5,
          title: 'Wait for label "Heavy"',
          status: "error",
          actions: [{ kind: "wait" }],
          frames: [
            { path: "frames/005.png", caption: 'after · Wait for label "Heavy"' },
            {
              path: "frames/006.png",
              caption: "failed:primary:Tap Expert, dismiss with Back key (not 540,400).",
            },
          ],
        },
        {
          id: "trace-dest",
          index: 6,
          title:
            "Capture for review · step:step-action:Tap Expert, dismiss with Back key (not 540,400).",
          status: "error",
          actions: [{ kind: "shot" }],
          frames: [
            {
              path: "frames/007.png",
              caption: "step:step-action:Tap Expert, dismiss with Back key (not 540,400).",
            },
          ],
        },
      ],
    },
    {},
  );
  expect(result.firstEvidence?.label).toBe("Tap Expert, dismiss with Back key (not 540,400).");
  expect(result.firstEvidence?.label).not.toBe('Wait for label "Heavy"');
  expect(result.timeline.map((step) => step.title)).toEqual([
    "Tap Expert, dismiss with Back key (not 540,400).",
  ]);
  const shotTitles = (
    result.evidence as readonly { items?: readonly { title?: string; id?: string }[] }[]
  )?.[0]?.items;
  expect(shotTitles?.map((item) => item.id)).toEqual(["frames/007.png"]);
  expect(shotTitles?.map((item) => item.title)).toEqual([
    "Tap Expert, dismiss with Back key (not 540,400).",
  ]);
  expect(shotTitles?.some((item) => /Wait for|failed:primary|^step:/u.test(item.title ?? ""))).toBe(
    false,
  );
});

it("dest-end Observe timeline keeps Capture frame, not leftover Run saved Test from testStepEvidence", () => {
  const result = projectRunReport(
    "dest-end-observe-leftover-004-framepaths",
    {
      outcome: "passed",
      artifacts: [
        {
          kind: "capture-review",
          data: {
            phase: "dest",
            caption: "step:step-observe:Observe",
            framePath: "frames/003.png",
            imageSha256: "dest-observe",
            stepId: "relay-test-step-observe",
          },
        },
      ],
      testStepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "step-observe",
          recipeId: "relay-test",
          recipeStepId: "relay-test-step-observe",
          traceStepId: "trace-leftover",
          traceStepIndex: 4,
          occurrence: 1,
          evidence: { framePaths: ["frames/004.png"], eventSequences: [], artifactKinds: [] },
        },
      ],
      steps: [
        {
          id: "trace-leftover",
          index: 4,
          title: "Run saved Test",
          status: "ok",
          actions: [{ kind: "ok" }],
          frames: [{ path: "frames/004.png", caption: "after · Run saved Test" }],
        },
        {
          id: "trace-dest",
          index: 8,
          recipeId: "relay-test",
          recipeStepId: "relay-test-step-observe",
          title: "Capture for review · step:step-observe:Observe",
          status: "ok",
          actions: [{ kind: "shot" }],
          frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe" }],
        },
      ],
    },
    {},
  );
  expect(result.firstEvidence?.label).toBe("Observe");
  expect(result.timeline).toHaveLength(1);
  expect(result.timeline[0]?.title).toBe("Observe");
  expect(result.timeline[0]?.framePaths).toEqual(["frames/003.png"]);
  expect(result.timeline[0]?.framePaths).not.toContain("frames/004.png");
});
