import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringTarget } from "@relay/protocol";
import type { RelayOutcomeJobs, RunTestSnapshot } from "@relay/workflows/types";
import { createProductRunJourney } from "./run-journey.js";

const target: AuthoringTarget = { kind: "device", platform: "android", targetId: "pixel-9" };

function snapshot(
  phase: RunTestSnapshot["phase"],
  expectedVersion = 4,
  extra: Partial<RunTestSnapshot> = {},
): RunTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: "Settings language",
    phase,
    version: `workflow-v${expectedVersion}`,
    workflow: { workflowId: "workflow-1", expectedVersion },
    frozen: {
      appMapId: "app-1",
      appMapRevision: 7,
      testId: "test-1",
      planDigest: "private-plan-digest",
      target,
    },
    execution: { jobId: "job-1", runId: "run-1" },
    progress: { label: phase, completed: phase === "running" ? 2 : undefined, total: 3 },
    allowedNextActions:
      phase === "queued" || phase === "running" ? ["inspect", "cancel"] : ["inspect"],
    problems: [],
    evidenceRefs: [{ kind: "run", id: "run-1" }],
    ...extra,
  };
}

function jobsFor(input: {
  started?: RunTestSnapshot;
  inspected?: RunTestSnapshot;
  watched?: RunTestSnapshot;
  cancelled?: RunTestSnapshot;
  onCancel?: (input: unknown) => void;
  onInspect?: (input: unknown) => void;
}): Pick<RelayOutcomeJobs, "run" | "inspect" | "watchWorkflow" | "cancelRun"> {
  return {
    async run() {
      return input.started ?? snapshot("queued");
    },
    async inspect(request) {
      input.onInspect?.(request);
      return input.inspected ?? input.started ?? snapshot("queued");
    },
    async watchWorkflow(request) {
      const next = input.watched ?? snapshot("succeeded", 5);
      request.onSnapshot?.(next);
      return next;
    },
    async cancelRun(request) {
      input.onCancel?.(request);
      return input.cancelled ?? snapshot("cancelled", 5);
    },
  };
}

test("start adopts canonical inspection and keeps the durable Run identity", async () => {
  const inspected = snapshot("running", 8, {
    execution: { jobId: "job-1", runId: "run-1" },
    progress: { label: "Running test", completed: 2, total: 4 },
  });
  let inspectedInput: unknown;
  const journey = createProductRunJourney({
    jobs: jobsFor({
      started: snapshot("queued", 7),
      inspected,
      onInspect: (input) => (inspectedInput = input),
    }),
  });

  const started = await journey.start({ testId: "test-1", appMapId: "app-1", targetId: "pixel-9" });
  assert.deepEqual(started.workflow, { workflowId: "workflow-1", expectedVersion: 7 });
  assert.deepEqual(started.run, { jobId: "job-1", runId: "run-1" });
  assert.deepEqual(started.snapshot?.workflow, { workflowId: "workflow-1", expectedVersion: 7 });
  assert.deepEqual(started.snapshot?.execution, { jobId: "job-1", runId: "run-1" });

  const current = await journey.inspect();
  assert.deepEqual(inspectedInput, { workflowId: "workflow-1" });
  assert.equal(current.snapshot?.phase, "running");
  assert.deepEqual(current.snapshot?.progress, { label: "Running test", completed: 2, total: 4 });
  assert.equal(current.snapshot?.target?.targetId, "pixel-9");
});

test("cancel forwards the latest durable version and publishes the server result", async () => {
  let cancelInput: unknown;
  const journey = createProductRunJourney({
    jobs: jobsFor({
      started: snapshot("running", 17),
      cancelled: snapshot("cancelled", 18),
      onCancel: (input) => (cancelInput = input),
    }),
  });

  await journey.start({ testId: "test-1", targetId: "pixel-9" });
  const cancelled = await journey.cancel();
  assert.deepEqual(cancelInput, {
    kind: "cancel-run",
    workflowId: "workflow-1",
    expectedVersion: 17,
    confirmCancel: true,
  });
  assert.equal(cancelled.snapshot?.workflow?.expectedVersion, 18);
  assert.equal(cancelled.snapshot?.phase, "cancelled");
});

test("watch follows canonical snapshots and exposes a completed Report route", async () => {
  const states: string[] = [];
  const journey = createProductRunJourney({
    jobs: jobsFor({ started: snapshot("running", 3), watched: snapshot("succeeded", 4) }),
  });
  await journey.start({ testId: "test-1" });
  const result = await journey.watch({ onState: (state) => states.push(state.status) });

  assert.deepEqual(states, ["succeeded"]);
  assert.equal(result.report?.id, "run-1");
  assert.equal(result.report?.reportId, "run-1");
  assert.equal(result.report?.runId, "run-1");
  assert.equal(result.report?.phase, "succeeded");
  assert.deepEqual(result.report?.target, target);
  assert.deepEqual(result.report?.navigation, {
    route: "/runs/run-1",
    href: "/runs/run-1",
  });
  assert.equal("passed" in (result.report ?? {}), false);
});

test("failed Runs preserve the server problem and transport errors become recovery guidance", async () => {
  const failed = snapshot("failed", 9, {
    problems: [
      {
        code: "operation-unavailable",
        title: "The test did not complete",
        detail: "The first check failed.",
        recovery: "Inspect the run evidence, then repair the Test.",
        retryable: false,
      },
    ],
  });
  const failure = createProductRunJourney({ jobs: jobsFor({ started: failed }) });
  const failedState = await failure.start({ testId: "test-1" });
  assert.equal(failedState.status, "failed");
  assert.equal(failedState.recovery?.code, "operation-unavailable");
  assert.equal(failedState.report?.phase, "failed");
  assert.equal(failedState.report?.target?.targetId, "pixel-9");

  const transport = createProductRunJourney({
    jobs: {
      ...jobsFor({ started: snapshot("running") }),
      async run() {
        throw new Error("network offline");
      },
    },
  });
  const recovered = await transport.start({ testId: "test-1" });
  assert.equal(recovered.recovery?.code, "transport");
  assert.equal(recovered.recovery?.action, "start");
  assert.equal(
    recovered.recovery?.recovery,
    "Start Relay at its saved address, then try again. Your work on this screen is safe.",
  );
  assert.doesNotMatch(JSON.stringify(recovered.recovery), /network offline/i);
});

test("compile diagnostics use public recovery language while preserving their source code", async () => {
  const blocked = snapshot("blocked", 1, {
    problems: [
      {
        code: "compile-blocked",
        title: "The Test has 1 compile blocker",
        detail:
          "Start has no immutable raw accessibility tree; recapture this screen before relying on offline geometry.",
        recovery: "Repair the reviewed Test evidence or selector, then start a new workflow.",
        retryable: false,
        sourceCode: "raw-evidence-recapture-required",
      },
    ],
  });
  const journey = createProductRunJourney({ jobs: jobsFor({ started: blocked }) });
  const state = await journey.start({ testId: "test-1" });

  assert.equal(state.recovery?.title, "The starting screen needs a fresh capture");
  assert.match(state.recovery?.detail ?? "", /run this Test safely/i);
  assert.match(state.recovery?.recovery ?? "", /record its starting screen again/i);
  assert.equal(state.recovery?.sourceCode, "raw-evidence-recapture-required");
  assert.doesNotMatch(JSON.stringify(state), /immutable raw accessibility|offline geometry/u);
});

test("public state does not leak compiled plans, refs, frozen internals, or raw payloads", async () => {
  const unsafe = Object.assign(snapshot("succeeded"), {
    ref: "relay-workflow.v1.private",
    compiled: { plan: { secret: "compiled-plan" }, preflight: { secret: "preflight" } },
    artifacts: [{ secret: "artifact-payload" }],
    result: { secret: "result-payload" },
  }) as RunTestSnapshot & Record<string, unknown>;
  const journey = createProductRunJourney({ jobs: jobsFor({ started: unsafe }) });
  const state = await journey.start({ testId: "test-1" });
  const serialized = JSON.stringify(state);

  assert.equal("ref" in (state.snapshot ?? {}), false);
  assert.equal("compiled" in (state.snapshot ?? {}), false);
  assert.equal("frozen" in (state.snapshot ?? {}), false);
  assert.doesNotMatch(serialized, /private|secret|payload/u);
});

test("an inspect transport failure never starts or cancels another Run", async () => {
  let cancelCalls = 0;
  const journey = createProductRunJourney({
    jobs: {
      ...jobsFor({ started: snapshot("running") }),
      async inspect() {
        throw new Error("Relay unavailable");
      },
      async cancelRun() {
        cancelCalls += 1;
        return snapshot("cancelled");
      },
    },
  });
  await journey.start({ testId: "test-1" });
  const inspected = await journey.inspect("workflow-1");
  assert.equal(inspected.recovery?.code, "transport");
  assert.equal(inspected.recovery?.action, "inspect");
  assert.equal(cancelCalls, 0);
});
