import assert from "node:assert/strict";
import test from "node:test";
import { runWithTargetContext } from "./target-context.js";
import { runRecipeSteps } from "./session.js";
import type { TestJob } from "./session-contract.js";
import type { Device } from "./device.js";

test("Run Across traces nested authored steps with their own recipe identity", async () => {
  const job = {
    id: "nested-trace",
    action: "test",
    platform: "android",
    queuedAt: Date.now(),
    steps: [],
    artifacts: [],
    frames: [],
    resolvedInputs: {},
    recipeId: "wrapper",
    recipeSnapshot: {
      id: "wrapper",
      title: "Run Across",
      steps: [{ kind: "module", recipeId: "test" }],
    },
    recipeGraph: {
      test: { id: "test", title: "Saved Test", steps: [{ kind: "module", recipeId: "leaf" }] },
      leaf: {
        id: "leaf",
        title: "Authored actions",
        steps: [
          { id: "first", kind: "sleep", ms: 0 },
          { id: "second", kind: "sleep", ms: 1 },
        ],
      },
    },
  } as unknown as TestJob;
  const device = {
    command: { wait: async () => {} },
    capture: {
      snapshot: async () => {
        throw new Error("no optional capture");
      },
    },
  } as unknown as Device;
  await runWithTargetContext({ kind: "device", platform: "android", serial: "trace-test" }, () =>
    runRecipeSteps(
      job,
      device,
      () => {},
      () => {},
    ),
  );
  assert.deepEqual(
    job.steps.map(({ recipeId, recipeStepId }) => [recipeId, recipeStepId]),
    [
      ["wrapper", "wrapper:1"],
      ["test", "test:1"],
      ["leaf", "first"],
      ["leaf", "second"],
    ],
  );
  assert.ok(job.steps.every((step) => step.status === "ok" && step.finishedAt));
  const commands = job.artifacts.filter((item) => item.kind === "command-attempt");
  assert.equal(commands.length, 4);
  assert.equal(new Set(commands.map((item) => (item.data as { stepId: string }).stepId)).size, 4);
});

test("a nested failure stays attributed to its authored step and fails its parent", async () => {
  const job = {
    id: "nested-failure",
    action: "test",
    platform: "android",
    queuedAt: Date.now(),
    steps: [],
    artifacts: [],
    frames: [],
    resolvedInputs: {},
    recipeId: "wrapper",
    recipeSnapshot: {
      id: "wrapper",
      title: "Run Across",
      steps: [{ kind: "module", recipeId: "leaf" }],
    },
    recipeGraph: {
      leaf: {
        id: "leaf",
        title: "Saved Test",
        steps: [
          { id: "broken", kind: "sleep", ms: 1 },
          { id: "unreached", kind: "sleep", ms: 0 },
        ],
      },
    },
  } as unknown as TestJob;
  const device = {
    command: {
      wait: async () => {
        throw new Error("device disconnected");
      },
    },
    capture: {
      snapshot: async () => {
        throw new Error("unavailable");
      },
    },
  } as unknown as Device;
  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "android", serial: "trace-test" }, () =>
      runRecipeSteps(
        job,
        device,
        () => {},
        () => {},
      ),
    ),
    /device disconnected/,
  );
  assert.deepEqual(
    job.steps.map((step) => [step.recipeStepId, step.status]),
    [
      ["wrapper:1", "error"],
      ["broken", "error"],
    ],
  );
});
