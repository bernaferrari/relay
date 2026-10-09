import assert from "node:assert/strict";
import test from "node:test";
import type { RecipeStep } from "@relay/protocol";
import type { Device } from "./device.js";
import {
  actCandidates,
  concreteStepsForDecision,
  normalizeActDecision,
  registerActDecider,
  runActStep,
  type ActDecision,
  type ActObservation,
} from "./recipe-runner-act.js";

const device = {} as Device;

function context() {
  const lines: string[] = [];
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  return { ctx: { log: (line: string) => lines.push(line), artifacts }, lines, artifacts };
}

const screen: ActObservation = {
  candidates: actCandidates([
    { label: "Settings", type: "Button", rect: { x: 0, y: 0, width: 20, height: 10 } },
    { identifier: "search", type: "TextField", rect: { x: 0, y: 20, width: 100, height: 10 } },
    { label: "Hidden", visibleToUser: false },
  ]),
};

test("candidates keep visible controls and mark editable fields", () => {
  assert.deepEqual(
    screen.candidates.map(({ id, label, identifier, editable }) => ({
      id,
      label,
      identifier,
      editable,
    })),
    [
      { id: "c1", label: "Settings", identifier: undefined, editable: undefined },
      { id: "c2", label: undefined, identifier: "search", editable: true },
    ],
  );
  assert.deepEqual(screen.candidates[0]!.target, { label: "Settings", point: { x: 10, y: 5 } });
  assert.deepEqual(screen.candidates[1]!.target, { identifier: "search" });
});

test("decisions translate into ordinary recipe steps", () => {
  assert.deepEqual(
    concreteStepsForDecision(
      { action: "type", text: "shoes", candidateId: "c2", submit: true, reason: "search" },
      screen.candidates,
    ).steps,
    [
      { kind: "type", text: "shoes", mode: "replace", target: { identifier: "search" } },
      { kind: "device", action: "keyboard-enter" },
    ],
  );
  assert.throws(
    () =>
      concreteStepsForDecision(
        { action: "tap", candidateId: "c9", reason: "?" },
        screen.candidates,
      ),
    /unknown control/,
  );
});

test("malformed model output becomes an explicit impossible decision", () => {
  assert.equal(normalizeActDecision({ action: "tap", reason: "no id" }).action, "impossible");
  assert.equal(normalizeActDecision("nonsense").action, "impossible");
});

async function run(decisions: ActDecision[], maxActions?: number) {
  const queue = [...decisions];
  const seenHistory: string[][] = [];
  const unregister = registerActDecider(async (input) => {
    seenHistory.push([...input.history]);
    return queue.shift() ?? { action: "done", reason: "fallback" };
  });
  const executed: RecipeStep[] = [];
  const { ctx, artifacts } = context();
  try {
    await runActStep(
      device,
      { kind: "act", intent: "Open Settings", ...(maxActions ? { maxActions } : {}) },
      ctx,
      async (step) => {
        executed.push(step);
      },
      async () => screen,
    );
    return { executed, artifacts, seenHistory, error: undefined };
  } catch (error) {
    return { executed, artifacts, seenHistory, error: error as Error };
  } finally {
    unregister();
  }
}

test("act executes chosen steps until the model reports done", async () => {
  const result = await run([
    { action: "tap", candidateId: "c1", reason: "Settings is visible" },
    { action: "done", reason: "Settings screen is open" },
  ]);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.executed, [
    { kind: "tap", target: { label: "Settings", point: { x: 10, y: 5 } } },
  ]);
  assert.deepEqual(result.seenHistory, [[], ["Tap Settings"]]);
  assert.deepEqual(
    result.artifacts.map((item) => (item.data as { action: string }).action),
    ["tap", "done"],
  );
});

test("finishesIntent skips the confirmation round trip", async () => {
  const result = await run([
    { action: "tap", candidateId: "c1", reason: "opens it", finishesIntent: true },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.seenHistory.length, 1);
});

test("impossible fails the step with what the model saw", async () => {
  const result = await run([{ action: "impossible", reason: "the page shows a login form" }]);
  assert.match(result.error?.message ?? "", /Could not open Settings: the page shows a login form/);
  assert.equal(result.executed.length, 0);
});

test("act stops after the action budget", async () => {
  const result = await run(
    [
      { action: "scroll", direction: "down", reason: "look" },
      { action: "scroll", direction: "down", reason: "look" },
      { action: "scroll", direction: "down", reason: "look" },
    ],
    2,
  );
  assert.match(result.error?.message ?? "", /within 2 actions \(tried: Scroll down, Scroll down\)/);
  assert.equal(result.executed.length, 2);
});
