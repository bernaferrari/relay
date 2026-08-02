import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import { appMapIdForJob, runStopHeadline } from "./run-presentation";

function job(action: string, data?: unknown): JobInfo {
  return {
    id: "run-1",
    action,
    status: "ok",
    queuedAt: 1,
    logs: [],
    steps: [],
    frames: [],
    attempts: 1,
    ...(data === undefined
      ? {}
      : { artifacts: [{ kind: "app-map-flow-plan", capturedAt: 1, data }] }),
  };
}

test("reports return generated App Map runs to their durable map", () => {
  assert.equal(appMapIdForJob(job("app-map:store:flow:main:r5")), "store");
  assert.equal(
    appMapIdForJob(job("generated-recipe", { appMapId: "checkout", rootRecipeId: "private" })),
    "checkout",
  );
  assert.equal(appMapIdForJob(job("login")), null);
});

test("zero-step failures never invent a first step", () => {
  assert.equal(
    runStopHeadline({ total: 0, selectedIndex: 0, failureLabel: "Setup" }),
    "Run stopped before the first step",
  );
  assert.equal(
    runStopHeadline({ total: 2, selectedIndex: 0, failureLabel: "Setup" }),
    "Setup at step 1 of 2",
  );
});
