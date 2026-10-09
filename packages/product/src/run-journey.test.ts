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

test("start adopts canonical inspection and keeps the durable run identity", async () => {
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

test("forwards selected setup and runtime prompt values as one canonical start request", async () => {
  let received: unknown;
  const journey = createProductRunJourney({
    jobs: {
      ...jobsFor({}),
      async run(input) {
        received = input;
        return snapshot("queued", 4, {
          frozen: {
            ...snapshot("queued").frozen!,
            targetProfileId: "profile-1",
            sourceRevision: { vcs: "git", sha: "abcdef1", buildId: "build-1" },
            startup: { mode: "cold" },
          },
        });
      },
    },
  });

  const state = await journey.start({
    testId: "test-1",
    appMapId: "app-1",
    targetId: "pixel-9",
    targetProfileId: "profile-1",
    sourceRevision: { vcs: "git", sha: "abcdef1", buildId: "build-1" },
    startup: { mode: "cold" },
    variables: { chat_prompt: "Prompt B" },
  });
  assert.deepEqual(received, {
    kind: "run-test",
    testId: "test-1",
    appMapId: "app-1",
    targetId: "pixel-9",
    targetProfileId: "profile-1",
    sourceRevision: { vcs: "git", sha: "abcdef1", buildId: "build-1" },
    startup: { mode: "cold" },
    variables: { chat_prompt: "Prompt B" },
  });
  assert.equal(state.snapshot?.phase, "queued");
});

test("starts the exact saved test revision acknowledged by the editor", async () => {
  let received: unknown;
  const journey = createProductRunJourney({
    jobs: {
      ...jobsFor({}),
      async run(input) {
        received = input;
        return snapshot("queued");
      },
    },
  });

  await journey.start({
    testId: "test-1",
    appMapId: "app-1",
    targetId: "pixel-9",
    documentRevision: 7,
  });
  assert.deepEqual(received, {
    kind: "run-test",
    testId: "test-1",
    appMapId: "app-1",
    targetId: "pixel-9",
    revision: { exact: 7 },
  });
});

test("reconstructed UI and CLI journeys inspect one server workflow and resume it without duplication", async () => {
  let starts = 0;
  let cancels = 0;
  const durable = snapshot("running", 12, {
    workflow: { workflowId: "workflow-shared", expectedVersion: 12 },
    execution: { jobId: "job-shared", runId: "run-shared" },
  });
  const jobs = jobsFor({
    inspected: durable,
    cancelled: {
      ...durable,
      phase: "cancelled",
      version: "workflow-v13",
      workflow: { workflowId: "workflow-shared", expectedVersion: 13 },
    },
    onCancel: () => (cancels += 1),
  });
  const cliJourney = createProductRunJourney({
    jobs: {
      ...jobs,
      async run() {
        starts += 1;
        return durable;
      },
    },
  });
  const first = await cliJourney.start({
    testId: "test-1",
    appMapId: "app-1",
    targetId: "pixel-9",
  });
  assert.equal(first.run?.runId, "run-shared");

  // Simulate a renderer restart: the new product service has no local pointer and can only
  // recover the server-owned workflow through the canonical inspect operation.
  const reconstructedUiJourney = createProductRunJourney({
    jobs: {
      ...jobs,
      async run() {
        starts += 1;
        return durable;
      },
    },
  });
  const restored = await reconstructedUiJourney.inspect("workflow-shared");
  assert.equal(restored.snapshot?.execution?.runId, "run-shared");
  const cancelled = await reconstructedUiJourney.cancel();
  assert.equal(cancelled.snapshot?.workflow?.workflowId, "workflow-shared");
  assert.equal(cancels, 1);
  assert.equal(
    starts,
    1,
    "resume must inspect and continue the existing workflow, never start a duplicate",
  );
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

test("watch follows canonical snapshots and exposes a completed report route", async () => {
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

test("failed runs preserve the server problem and transport errors become recovery guidance", async () => {
  const failed = snapshot("failed", 9, {
    problems: [
      {
        code: "operation-unavailable",
        title: "The test did not complete",
        detail: "The first check failed.",
        recovery: "Inspect the run evidence, then repair the test.",
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
        title: "The test has 1 compile blocker",
        detail:
          "Start has no immutable raw accessibility tree; recapture this screen before relying on offline geometry.",
        recovery: "Repair the reviewed test evidence or selector, then start a new workflow.",
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

test("captured setup recovery retains the canonical source step in public run state", async () => {
  const blocked = snapshot("blocked", 1, {
    workflow: undefined,
    execution: undefined,
    problems: [
      {
        code: "compile-blocked",
        sourceCode: "target-profile-ambiguous",
        sourceStepId: "step-d950-source",
        title: "The test has 1 compile blocker",
        detail:
          "Saved target profile device:private-phone:1080x2340 has conflicting route-selection facts",
        recovery: "Open the test editor and resolve its blocking compile diagnostics.",
        retryable: false,
      },
    ],
  });
  const journey = createProductRunJourney({ jobs: jobsFor({ started: blocked }) });
  const state = await journey.start({ testId: "test-speed" });
  assert.equal(state.recovery?.sourceStepId, "step-d950-source");
  assert.equal(state.snapshot?.problems[0]?.sourceStepId, "step-d950-source");
  assert.equal(state.recovery?.title, "Saved setup needs review");
  assert.equal(state.recovery?.retryable, false);
  assert.doesNotMatch(JSON.stringify(state.recovery), /private-phone|1080x2340|route-selection/u);
  assert.equal(state.run, undefined);
});

test("an inspect transport failure never starts or cancels another run", async () => {
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

test("watch A, inspect B, late A, cancel B only cancels B", async () => {
  const runA = snapshot("running", 3, {
    workflow: { workflowId: "workflow-A", expectedVersion: 3 },
    execution: { jobId: "job-A", runId: "run-A" },
  });
  const runB = snapshot("running", 8, {
    workflow: { workflowId: "workflow-B", expectedVersion: 8 },
    execution: { jobId: "job-B", runId: "run-B" },
  });
  const lateA = snapshot("running", 4, {
    workflow: { workflowId: "workflow-A", expectedVersion: 4 },
    execution: { jobId: "job-A", runId: "run-A" },
  });
  let emitLateA: ((next: RunTestSnapshot) => void) | undefined;
  let resolveWatchA: (() => void) | undefined;
  const watchAReady = new Promise<void>((resolve) => {
    resolveWatchA = resolve;
  });
  const cancelPayloads: unknown[] = [];
  const watchAStates: string[] = [];
  const journey = createProductRunJourney({
    jobs: {
      ...jobsFor({}),
      async inspect(request) {
        return request.workflowId === "workflow-B" ? runB : runA;
      },
      async watchWorkflow(request) {
        if (request.workflowId === "workflow-A") {
          emitLateA = (next) => request.onSnapshot?.(next);
          resolveWatchA?.();
          await new Promise(() => undefined);
        }
        return request.workflowId === "workflow-B" ? runB : runA;
      },
      async cancelRun(request) {
        cancelPayloads.push(request);
        return snapshot("cancelled", request.expectedVersion + 1, {
          workflow: {
            workflowId: request.workflowId,
            expectedVersion: request.expectedVersion + 1,
          },
        });
      },
    },
  });

  await journey.inspect("workflow-A");
  void journey.watch({
    workflowId: "workflow-A",
    onState: (state) => watchAStates.push(state.workflow?.workflowId ?? ""),
  });
  await watchAReady;
  await journey.inspect("workflow-B");
  emitLateA?.(lateA);
  const cancelled = await journey.cancel({ workflowId: "workflow-B" });

  assert.deepEqual(cancelPayloads, [
    {
      kind: "cancel-run",
      workflowId: "workflow-B",
      expectedVersion: 8,
      confirmCancel: true,
    },
  ]);
  assert.equal(cancelled.snapshot?.workflow?.workflowId, "workflow-B");
  assert.equal(journey.state().snapshot?.workflow?.workflowId, "workflow-B");
  assert.equal(watchAStates.includes("workflow-B"), false);
});

test("aborting watch A after inspecting B returns A and never writes B into A", async () => {
  const runA = snapshot("running", 3, {
    workflow: { workflowId: "workflow-A", expectedVersion: 3 },
    execution: { jobId: "job-A", runId: "run-A" },
  });
  const runB = snapshot("running", 8, {
    workflow: { workflowId: "workflow-B", expectedVersion: 8 },
    execution: { jobId: "job-B", runId: "run-B" },
  });
  let rejectWatchA: ((error: Error) => void) | undefined;
  let resolveWatchAReady: (() => void) | undefined;
  const watchAReady = new Promise<void>((resolve) => {
    resolveWatchAReady = resolve;
  });
  const journey = createProductRunJourney({
    jobs: {
      ...jobsFor({}),
      async inspect(request) {
        return request.workflowId === "workflow-B" ? runB : runA;
      },
      async watchWorkflow(request) {
        if (request.workflowId === "workflow-A") {
          resolveWatchAReady?.();
          return await new Promise<RunTestSnapshot>((_resolve, reject) => {
            rejectWatchA = reject;
          });
        }
        return runB;
      },
    },
  });

  await journey.inspect("workflow-A");
  const watchA = journey.watch({ workflowId: "workflow-A" });
  await watchAReady;
  await journey.inspect("workflow-B");
  const abort = new Error("aborted");
  abort.name = "AbortError";
  rejectWatchA?.(abort);
  const aborted = await watchA;
  assert.equal(aborted.snapshot?.workflow?.workflowId, "workflow-A");
  assert.equal(aborted.snapshot?.execution?.runId, "run-A");
  assert.equal(journey.state().snapshot?.workflow?.workflowId, "workflow-B");
});

test("inspect A failing while B is selected does not write recovery onto B", async () => {
  const runB = snapshot("running", 8, {
    workflow: { workflowId: "workflow-B", expectedVersion: 8 },
    execution: { jobId: "job-B", runId: "run-B" },
  });
  const journey = createProductRunJourney({
    jobs: {
      ...jobsFor({}),
      async inspect(request) {
        if (request.workflowId === "workflow-A") throw new Error("workflow A is gone");
        return runB;
      },
    },
  });
  await journey.inspect("workflow-B");
  const failed = await journey.inspect("workflow-A");
  assert.equal(failed.recovery?.action, "inspect");
  assert.notEqual(failed.snapshot?.workflow?.workflowId, "workflow-B");
  assert.equal(journey.state().snapshot?.workflow?.workflowId, "workflow-B");
  assert.equal(journey.state().recovery, undefined);
});

test("start forwards the exact account binding instead of dropping it", async () => {
  let received: unknown;
  const journey = createProductRunJourney({
    jobs: {
      ...jobsFor({}),
      async run(intent) {
        received = intent;
        return snapshot("queued");
      },
    },
  });
  await journey.start({
    testId: "checkout",
    appMapId: "app-1",
    targetId: "browser-1",
    engine: "chromium",
    account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
  });
  const intent = received as {
    account?: unknown;
    engine?: unknown;
    targetId?: unknown;
    testId?: unknown;
  };
  assert.equal(intent.testId, "checkout");
  assert.equal(intent.targetId, "browser-1");
  assert.equal(intent.engine, "chromium");
  assert.deepEqual(intent.account, {
    kind: "fixture",
    accountId: "acct-member",
    accountRevision: "7",
  });
});
