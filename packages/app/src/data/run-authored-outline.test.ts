import { expect, it } from "vitest";
import { retainedNativeFastRun } from "./fixtures/native-fast-authored-run";
import { projectRunReport } from "./run-report-projection";

const fixture = () => structuredClone(retainedNativeFastRun);
const report = (run = fixture()) => projectRunReport("a1a09d67", run, {});

it("joins all 31 actual occurrences once, including the Type confirmation and final capture", () => {
  const run = fixture();
  const outline = report(run).authoredOutline!;
  expect(outline.steps).toHaveLength(7);
  expect(outline.steps.map((step) => step.title)).toEqual([
    "Start a new conversation",
    "Open model menu",
    "Fast",
    "Check control is gone",
    "Type text",
    "Send prompt",
    "Wait for a new reply",
  ]);
  const occurrences = [
    ...outline.steps.flatMap((step) => step.children),
    ...outline.supportingSteps,
  ];
  expect(occurrences).toHaveLength(31);
  expect(new Set(occurrences.map((step) => step.id)).size).toBe(31);
  const type = outline.steps[4]!;
  expect(type.children.map((step) => step.id)).toEqual(
    run.steps.slice(19, 24).map((step) => step.id),
  );
  expect(type.durationMs).toBe(run.steps[19]!.durationMs + run.steps[23]!.durationMs);
  expect(type.framePaths).toEqual([
    ...new Set(run.steps.slice(19, 24).flatMap((step) => step.frames.map((frame) => frame.path))),
  ]);
  expect(outline.supportingSteps.map((step) => step.id)).toEqual([
    run.steps[0]!.id,
    run.steps[30]!.id,
  ]);
});

it("retains failure before a following capture and leaves later authored actions pending", () => {
  const run = fixture();
  run.outcome = "failed";
  run.steps = run.steps.slice(0, 4);
  for (const index of [0, 1, 3]) {
    run.steps[index]!.status = "error";
    run.steps[index]!.finishedAt = run.steps[3]!.finishedAt;
  }
  run.steps[3]!.frames = [];
  const outline = report(run).authoredOutline!;
  expect(outline.steps[0]?.state).toBe("failed");
  expect(outline.steps[0]?.children.at(-1)?.id).toBe(run.steps[3]?.id);
  expect(outline.steps[0]?.children.at(-1)?.state).toBe("failed");
  expect(outline.steps.slice(1).every((step) => step.state === "pending")).toBe(true);
});

it("keeps failed, recovered and unresolved supporting occurrences visible", () => {
  const run = fixture();
  run.steps[20]!.status = "healed";
  run.steps[21]!.status = "error";
  const unknown = {
    ...run.steps[30]!,
    id: "unresolved-setup",
    recipeId: "unmapped-setup",
    recipeStepId: "setup-1",
    title: "Read launch readiness",
    status: "error",
  };
  run.steps.push(unknown);
  const outline = report(run).authoredOutline!;
  expect(outline.steps[4]?.children.map((step) => step.state)).toContain("recovered");
  expect(outline.steps[4]?.children.map((step) => step.state)).toContain("failed");
  expect(outline.steps[4]?.state).toBe("failed");
  expect(outline.supportingSteps.at(-1)?.id).toBe("unresolved-setup");
  expect(outline.supportingSteps.at(-1)?.state).toBe("failed");
});

it.each([
  "repeated occurrence",
  "conflicting provenance",
  "outside wrapper",
  "overlapping invocation",
  "missing identity",
])("falls back without hiding evidence for %s", (reason) => {
  const run = fixture();
  if (reason === "repeated occurrence")
    run.steps.push({ ...run.steps[15]!, id: "second-fast-invocation" });
  if (reason === "conflicting provenance") {
    const source = run.artifacts[0]!.data.child.plan.stepProvenance[0]!;
    run.artifacts[0]!.data.child.plan.stepProvenance.push({
      ...source,
      testStepId: "another-action",
    });
  }
  if (reason === "outside wrapper") run.steps[15]!.finishedAt = run.steps[13]!.finishedAt + 1;
  if (reason === "overlapping invocation") run.steps[13]!.startedAt = run.steps[8]!.finishedAt - 1;
  if (reason === "missing identity") run.steps[15]!.recipeStepId = "not-the-retained-step";
  const projected = report(run);
  expect(projected.authoredOutline).toBeUndefined();
  expect(projected.traceSteps).toHaveLength(run.steps.length);
});

it("uses exact frozen direct intent and does not alter the full diagnostic timeline", () => {
  const run = fixture();
  const projected = report(run);
  const direct = {
    ...run,
    artifacts: [{ kind: "app-map-test-execution-intent", data: run.artifacts[0]!.data.child }],
  };
  expect(projectRunReport("direct", direct, {}).authoredOutline?.steps).toEqual(
    projected.authoredOutline?.steps,
  );
  const legacy = { ...run, artifacts: [] };
  const noGrouping = fixture();
  noGrouping.artifacts[0]!.data.child.plan.stepProvenance = [];
  expect(report(noGrouping).authoredOutline).toBeUndefined();
  expect(report(noGrouping).timeline).toEqual(projected.timeline);
  expect(report(noGrouping).traceSteps).toEqual(projected.traceSteps);
  expect(projectRunReport("legacy", legacy, {}).authoredOutline).toBeUndefined();
});

it("refuses a modern malformed graph or root mismatch rather than deriving ownership from titles", () => {
  const run = fixture();
  run.artifacts[0]!.data.wrapper.childRootRecipeId = "another-root";
  expect(report(run).authoredOutline).toBeUndefined();
  const noGraph = fixture();
  noGraph.artifacts[0]!.data.child.recipeGraph = {};
  expect(report(noGraph).authoredOutline).toBeUndefined();
});
