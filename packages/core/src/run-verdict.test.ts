import assert from "node:assert/strict";
import test from "node:test";
import { buildRunVerdict, plainReason } from "./run-verdict.js";
import type { PersistedRun } from "./runs.js";

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
    "Text entry verification failed: readback differs.",
  );
});
