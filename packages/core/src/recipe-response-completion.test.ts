import assert from "node:assert/strict";
import test from "node:test";
import { runRecipeStep } from "./recipe-runner.js";
import { captureResponseBoundary } from "./recipe-response-boundary.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { Device, SnapshotNode } from "./device.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

const result = { label: "Copy message", role: "button", visibleToUser: true };
const busy = { label: "Stop message", role: "button", visibleToUser: true };
const wait = {
  kind: "wait-response" as const,
  target: { label: "Copy message" },
  busyTarget: { label: "Stop message" },
  idleTarget: { label: "Copy message" },
  timeoutMs: 200,
  stableForMs: 10,
};

function fixture(read: () => Promise<SnapshotNode[]>) {
  const owner = { artifacts: [], resolvedInputs: {} } as unknown as TestJob;
  const device = {
    command: {
      wait: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    },
    capture: { snapshot: async () => ({ nodes: await read() }) },
  } as unknown as Device;
  const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
  const run = () =>
    runWithTargetContext(
      { kind: "browser", platform: "browser", targetId: "readiness-fixture" },
      () => runRecipeStep(device, wait, ctx),
    );
  const receipt = () =>
    owner.artifacts.find((artifact) => artifact.kind === "response-completion")?.data as Record<
      string,
      unknown
    >;
  return { ctx, run, receipt };
}

test("old Copy remains unproven after input even with fresh refs and idle chrome", async () => {
  const value = fixture(async () => [{ ...result, ref: "@new" }]);
  value.ctx.runtime!.responseBoundary = captureResponseBoundary(
    [{ ...result, ref: "@old" }],
    "initiating-action",
    "type-prompt",
  );
  await assert.rejects(value.run, /response completion: timed out/u);
  assert.equal(value.receipt().status, "timeout");
  assert.equal(value.receipt().timingBasis, "input-to-readiness");
});

test("one readiness wait requires the observed busy control to leave and new result to stabilize", async () => {
  let reads = 0;
  const value = fixture(async () => (++reads < 3 ? [result, busy] : [result]));
  const boundary = captureResponseBoundary([], "initiating-action", "type-prompt");
  value.ctx.runtime!.responseBoundary = boundary;
  await value.run();
  const receipt = value.receipt();
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.beganAt, boundary.capturedAt);
  assert.equal(receipt.deadline, boundary.capturedAt + wait.timeoutMs);
  assert.equal(receipt.timingBasis, "input-to-readiness");
  assert.equal(receipt.initiatingActionId, "type-prompt");
  assert.ok(reads >= 3);
});

test("an expired input deadline is not renewed when the wait begins", async () => {
  let reads = 0;
  const value = fixture(async () => {
    reads += 1;
    return reads === 1 ? [] : [result];
  });
  const boundary = captureResponseBoundary([], "initiating-action", "type-prompt");
  value.ctx.runtime!.responseBoundary = { ...boundary, capturedAt: boundary.capturedAt - 500 };
  await assert.rejects(value.run, /response completion: timed out/u);
  assert.equal(reads, 0);
  assert.equal(value.receipt().samples, 0);
  assert.equal(value.receipt().status, "timeout");
  assert.ok(Number(value.receipt().durationMs) >= 500);
});

test("a late snapshot cannot make result readiness appear inside the input budget", async () => {
  const value = fixture(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return [result];
  });
  const boundary = captureResponseBoundary([], "initiating-action", "type-prompt");
  value.ctx.runtime!.responseBoundary = { ...boundary, capturedAt: boundary.capturedAt - 170 };
  await assert.rejects(value.run, /response completion: timed out/u);
  assert.equal(value.receipt().status, "timeout");
});

test("explicit waits without an input boundary keep a deadline from wait start", async () => {
  let reads = 0;
  const value = fixture(async () => {
    reads += 1;
    return reads === 1 ? [] : [result];
  });
  await value.run();
  const receipt = value.receipt();
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.timingBasis, "wait-to-readiness");
  assert.equal(receipt.beganAt, receipt.waitBeganAt);
  assert.equal(receipt.deadline, Number(receipt.waitBeganAt) + wait.timeoutMs);
  assert.ok(reads >= 2);
});
