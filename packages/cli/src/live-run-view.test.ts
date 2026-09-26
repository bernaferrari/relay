import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  LiveRunView,
  liveRowFromJob,
  liveRowFromWorkflow,
  renderLiveFrame,
  summarizeRows,
} from "./live-run-view.js";

test("a job row shows the step in progress, then the outcome", () => {
  assert.deepEqual(
    liveRowFromJob({
      id: "j1",
      title: "Checkout",
      status: "running",
      startedAt: 1_000,
      steps: [
        { title: "Open cart", status: "ok" },
        { title: 'Tap "Pay"', status: "running" },
      ],
    }),
    {
      id: "j1",
      title: "Checkout",
      state: "running",
      detail: 'step 2 · Tap "Pay"',
      startedAt: 1_000,
    },
  );
  assert.equal(
    liveRowFromJob({ id: "j1", status: "ok", steps: [{}], captureSummary: { pending: 2 } })?.detail,
    "2 screenshots to review",
  );
  assert.equal(
    liveRowFromJob({ id: "j1", status: "error", steps: [{ title: "Pay", status: "failed" }] })
      ?.detail,
    "Pay",
  );
});

test("a workflow row reads step counts and review", () => {
  assert.deepEqual(
    liveRowFromWorkflow({
      title: "Login",
      phase: "running",
      progress: { label: "Tap Sign in", completed: 1, total: 3 },
      workflow: { workflowId: "w1" },
    }),
    { id: "w1", title: "Login", state: "running", detail: "step 1/3 · Tap Sign in" },
  );
  assert.equal(
    liveRowFromWorkflow({ title: "Login", phase: "succeeded", review: { pending: 1 } })?.state,
    "review",
  );
  assert.equal(liveRowFromWorkflow({ title: "Login", phase: "succeeded" })?.state, "passed");
});

test("the frame lists every Test with a summary line", () => {
  const rows = [
    { id: "a", title: "Home", state: "passed" as const, detail: "4 steps" },
    {
      id: "b",
      title: "Dictation",
      state: "running" as const,
      detail: "step 2 · Tap Mic",
      startedAt: 0,
    },
    { id: "c", title: "Sidebar", state: "queued" as const },
  ];
  const lines = renderLiveFrame({
    header: { title: "Daily QA", target: "iPad", startedAt: 0 },
    rows,
    now: 42_000,
    frame: 0,
    width: 80,
    colors: false,
  });
  assert.match(lines[0]!, /Relay ▸ Daily QA · iPad\s+0:42$/u);
  assert.match(lines[1]!, /✓ Home\s+4 steps/u);
  assert.match(lines[2]!, /⠋ Dictation\s+step 2 · Tap Mic\s+0:42/u);
  assert.match(lines[3]!, /· Sidebar\s+queued/u);
  assert.equal(summarizeRows(rows), "1/3 done · 1 passed");
});

test("without a terminal, only changes are printed", () => {
  const stream = new PassThrough();
  let written = "";
  stream.on("data", (chunk) => (written += String(chunk)));
  const view = new LiveRunView(stream, { title: "Daily QA" });
  view.update([{ id: "a", title: "Home", state: "running", detail: "step 1" }]);
  view.update([{ id: "a", title: "Home", state: "running", detail: "step 1" }]);
  view.update([{ id: "a", title: "Home", state: "passed", detail: "4 steps" }]);
  view.finish();
  assert.equal(written, "Home: running · step 1\nHome: passed · 4 steps\n");
});
