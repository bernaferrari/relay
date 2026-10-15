import assert from "node:assert/strict";
import test from "node:test";
import { agentVerdict, withFailingStep } from "./run-verdict-wait.js";

test("reserving an early failure does not shrink or duplicate the bounded step list", () => {
  const verdict = agentVerdict({
    steps: Array.from({ length: 45 }, (_, i) => ({
      id: String(i),
      status: i === 0 ? "failed" : "passed",
    })),
  });
  const steps = verdict.steps as { id: string }[];
  assert.equal(steps.length, 40);
  assert.equal(new Set(steps.map((step) => step.id)).size, 40);
  assert.equal(verdict.moreSteps, 5);
});

test("bounded MCP verdicts and failure inspection retain a failure after step 40", async () => {
  const verdict = {
    status: "failed",
    summary: "Failed at final check",
    steps: Array.from({ length: 45 }, (_, i) => ({
      id: String(i + 1),
      title: `Step ${i + 1}`,
      status: i === 44 ? "failed" : "passed",
      ...(i === 44 ? { expected: "Saved", saw: "Error" } : {}),
    })),
  };
  const compact = agentVerdict(verdict);
  const steps = compact.steps as typeof verdict.steps;
  assert.equal(steps.length, 40);
  assert.equal(steps.find((s) => s.status === "failed")?.id, "45");
  assert.equal(compact.moreSteps, 5);
  const inspected = (await withFailingStep({}, "run", {
    invoker: { invoke: async () => ({ verdict }) } as never,
    signal: new AbortController().signal,
  })) as { verdict: { failingStep: { id: string; saw: string } } };
  assert.equal(inspected.verdict.failingStep.id, "45");
  assert.equal(inspected.verdict.failingStep.saw, "Error");
});
