import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedRun } from "../context/server";
import { persistedAsJob } from "./persisted-run";

test("marks run artifacts loaded from disk as persisted", () => {
  const run = {
    id: "run-1",
    action: "app-map:store:flow:main",
    status: "ok",
    startedAt: 10,
    finishedAt: 20,
    writtenAt: 21,
    steps: [],
    frames: [],
  } as unknown as PersistedRun;

  const job = persistedAsJob(run);

  assert.equal(job.persisted, true);
  assert.equal(job.queuedAt, 10);
});
