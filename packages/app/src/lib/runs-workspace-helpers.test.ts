import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import { runsEqualForSelection, summarizeRunBatch } from "./runs-workspace-helpers";

function run(input: Partial<JobInfo> & Pick<JobInfo, "id" | "status">): JobInfo {
  return {
    action: "settings-tour",
    attempts: 1,
    logs: [],
    queuedAt: 1,
    ...input,
  } as JobInfo;
}

test("presents one matrix execution instead of one unrelated row per value", () => {
  const rows = [
    run({
      id: "en",
      batchId: "languages",
      title: "Check Settings · across · en",
      status: "ok",
      durationMs: 100,
    }),
    run({
      id: "it",
      batchId: "languages",
      title: "Check Settings · across · it",
      status: "error",
      durationMs: 200,
    }),
  ];

  assert.deepEqual(summarizeRunBatch(rows[0]!, rows), {
    title: "Check Settings",
    count: 2,
    passed: 1,
    attention: 1,
    active: 0,
    durationMs: 300,
    status: "1 passed · 1 need attention",
    tone: "attention",
  });
});

test("ordinary runs remain ordinary history rows", () => {
  const row = run({ id: "single", status: "ok", title: "Open Settings" });
  assert.equal(summarizeRunBatch(row, [row]), null);
});

test("loading full steps invalidates the selected run projection", () => {
  const summary = run({ id: "run", status: "ok", steps: [] });
  const detail = run({
    id: "run",
    status: "ok",
    steps: [{ id: "step", title: "Open Settings" } as NonNullable<JobInfo["steps"]>[number]],
  });

  assert.equal(runsEqualForSelection(summary, detail), false);
});
