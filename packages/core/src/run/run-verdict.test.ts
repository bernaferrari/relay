import assert from "node:assert/strict";
import test from "node:test";
import { buildRunVerdict, plainReason } from "./run-verdict.js";
import type { PersistedRun } from "./run-store.js";

function run(overrides: Partial<PersistedRun>): PersistedRun {
  return {
    schemaVersion: 5,
    id: "run-1",
    action: "app-map:shop:test:checkout",
    status: "error",
    attempts: 1,
    queuedAt: 0,
    logs: [],
    steps: [],
    frames: [],
    dir: "/runs/run-1",
    writtenAt: 0,
    artifacts: [],
    inputDigest: "",
    resolvedInputs: {},
    ...overrides,
  } as PersistedRun;
}

const evidence = (
  testStepId: string,
  traceStepId: string,
  index: number,
  frames: string[] = [],
) => ({
  schemaVersion: 1 as const,
  testStepId,
  recipeId: "r",
  recipeStepId: `${testStepId}-1`,
  traceStepId,
  traceStepIndex: index,
  occurrence: 1,
  evidence: { framePaths: frames, eventSequences: [], artifactKinds: [] },
});

const authored = {
  name: "Checkout",
  steps: [
    { id: "open", kind: "instruction", intent: "Open the cart" },
    { id: "check", kind: "validation", intent: "The total is $10" },
    { id: "pay", kind: "instruction", intent: "Pay" },
  ] as never,
};

test("a product failure names the step, what was expected, and what Relay saw", () => {
  const verdict = buildRunVerdict(
    run({
      outcome: "product-failure",
      error: "visual assertion: The total shows $12.",
      steps: [
        { id: "t1", status: "ok", frames: [], log: "" },
        { id: "t2", status: "error", frames: [{ path: "frames/002.png" }], log: "" },
      ] as never,
      testStepEvidence: [evidence("open", "t1", 0), evidence("check", "t2", 1)],
      artifacts: [
        {
          kind: "visual-evaluation",
          capturedAt: 1,
          data: { status: "fail", summary: "The total shows $12." },
        },
      ],
    }),
    authored,
  );
  assert.equal(verdict.status, "failed");
  assert.equal(verdict.summary, "Failed at “The total is $10”: The total shows $12.");
  assert.deepEqual(
    verdict.steps.map(({ id, status }) => [id, status]),
    [
      ["open", "passed"],
      ["check", "failed"],
      ["pay", "not-run"],
    ],
  );
  assert.equal(verdict.steps[1]!.expected, "The total is $10");
  assert.equal(verdict.steps[1]!.screenshot, "/runs/run-1/frames/002.png");
});

test("harness problems are blocked, not failures, and passing runs say so plainly", () => {
  assert.equal(buildRunVerdict(run({ outcome: "harness-failure" }), authored).status, "blocked");
  assert.equal(buildRunVerdict(run({ outcome: "uncertain" }), authored).status, "blocked");
  const passed = buildRunVerdict(
    run({
      outcome: "passed",
      status: "ok",
      steps: [{ id: "t1", status: "ok", frames: [], log: "" }] as never,
      testStepEvidence: [evidence("open", "t1", 0)],
    }),
    { name: "Open", steps: [authored.steps[0]] as never },
  );
  assert.equal(passed.summary, "Passed · 1 of 1 steps");
  assert.equal(passed.reason, undefined);
});

test("runner phrasing becomes plain sentences", () => {
  assert.equal(
    plainReason("expect-screen: on “unknown”, not “Imagine” after 5000ms. Next: retry"),
    "Expected the “Imagine” screen within 5 s, but Relay didn’t recognize the screen it was on.",
  );
  assert.equal(
    plainReason("7 campaign checks failed: Tap “Imagine”: expect-screen: on “Home”, not “Imagine”"),
    "Expected the “Imagine” screen, but it was on “Home”.",
  );
  assert.equal(
    plainReason("check cleanup skipped: x\n✗ Text entry verification failed: readback differs."),
    "Relay typed the text, but couldn’t confirm the field received it.",
  );
});

test("the step that stopped the run shows the screen at the moment it failed", () => {
  const verdict = buildRunVerdict(
    run({
      outcome: "harness-failure",
      error:
        "Text entry verification failed: the field readback does not match the requested text.",
      frames: [
        { path: "frames/001.png", caption: "step:open:Open the cart", capturedAt: 10 },
        { path: "frames/003.png", caption: "failed:primary:Type text", capturedAt: 35 },
      ],
      steps: [
        { id: "t1", status: "ok", frames: [], log: "", startedAt: 0, finishedAt: 11 },
        {
          id: "t2",
          status: "error",
          frames: [
            { path: "frames/002.png", caption: "after · Type text", capturedAt: 30 },
            { path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 40 },
          ],
          log: "",
          startedAt: 20,
          finishedAt: 41,
        },
      ] as never,
      testStepEvidence: [evidence("open", "t1", 0, ["frames/001.png"]), evidence("check", "t2", 1)],
    }),
    authored,
  );
  assert.equal(verdict.status, "blocked");
  assert.equal(verdict.steps[1]!.screenshot, "/runs/run-1/frames/003.png");
  assert.equal(
    verdict.steps[1]!.saw,
    "Relay typed the text, but the field showed something different.",
  );
});

test("plain-English steps surface how they were carried out without changing the outcome", () => {
  const plan = {
    kind: "app-map-test-plan",
    capturedAt: 1,
    data: {
      appMapId: "shop",
      test: { id: "checkout" },
      stepProvenance: [
        { recipeStepId: "relay-test-open-1", testStepId: "open" },
        { recipeStepId: "relay-test-pay-1", testStepId: "pay" },
      ],
    },
  };
  const verdict = buildRunVerdict(
    run({
      outcome: "passed",
      status: "ok",
      steps: [
        { id: "t1", status: "ok", frames: [], log: "" },
        { id: "t2", status: "ok", frames: [], log: "" },
        { id: "t3", status: "ok", frames: [], log: "" },
      ] as never,
      testStepEvidence: [
        evidence("open", "t1", 0),
        evidence("check", "t2", 1),
        evidence("pay", "t3", 2),
      ],
      artifacts: [
        plan,
        {
          kind: "act-result",
          capturedAt: 2,
          data: {
            intent: "Open the cart",
            recipeStepId: "relay-test-open-1",
            source: "cache",
            steps: [],
          },
        },
        {
          kind: "act-decision",
          capturedAt: 3,
          data: {
            intent: "Pay",
            recipeStepId: "relay-test-pay-1",
            action: "cache-miss",
            reason: "x",
          },
        },
        {
          kind: "act-result",
          capturedAt: 4,
          data: { intent: "Pay", recipeStepId: "relay-test-pay-1", source: "model", steps: [] },
        },
      ],
    }),
    authored,
  );
  assert.equal(verdict.status, "passed");
  assert.deepEqual(verdict.steps[0]!.replay, { source: "cache" });
  assert.equal(verdict.steps[1]!.replay, undefined);
  assert.deepEqual(verdict.steps[2]!.replay, {
    source: "re-resolved",
    detail: "re-resolved after the saved path no longer matched",
  });
  assert.equal(verdict.replayedSteps, 1);
  assert.equal(verdict.reResolvedSteps, 1);
  // Healing is invisible in the outcome by design.
  assert.equal(verdict.summary, "Passed · 3 of 3 steps");
});

test("a first model resolution without a miss reads as model, never as re-resolved", () => {
  const verdict = buildRunVerdict(
    run({
      outcome: "passed",
      status: "ok",
      steps: [{ id: "t1", status: "ok", frames: [], log: "" }] as never,
      testStepEvidence: [evidence("open", "t1", 0)],
      artifacts: [
        {
          kind: "app-map-test-plan",
          capturedAt: 1,
          data: {
            appMapId: "shop",
            test: { id: "checkout" },
            stepProvenance: [{ recipeStepId: "relay-test-open-1", testStepId: "open" }],
          },
        },
        {
          kind: "act-result",
          capturedAt: 2,
          data: {
            intent: "Open the cart",
            recipeStepId: "relay-test-open-1",
            source: "model",
            steps: [],
          },
        },
      ],
    }),
    authored,
  );
  assert.deepEqual(verdict.steps[0]!.replay, { source: "model" });
  assert.equal(verdict.replayedSteps, undefined);
  assert.equal(verdict.reResolvedSteps, undefined);
});
