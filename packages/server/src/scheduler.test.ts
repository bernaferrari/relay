import assert from "node:assert/strict";
import test from "node:test";
import { startScheduler } from "./scheduler.js";

test("scheduler close waits for an in-flight poll before session shutdown can begin", async () => {
  let started!: () => void;
  let release!: () => void;
  const polling = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let polls = 0;
  const scheduler = startScheduler(1, async () => {
    polls += 1;
    started();
    await held;
  });

  await polling;
  let closed = false;
  const closing = scheduler.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  release();
  await closing;
  assert.equal(polls, 1);
});
