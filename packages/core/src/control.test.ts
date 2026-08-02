import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JobCancelledError,
  clearControl,
  debugWaiterCount,
  ensureControl,
  raceCancel,
  requestCancel,
  requestPause,
  requestResume,
  runWithJobControl,
  setExecutingJobId,
  throwIfCancelled,
  cooperativeCheckpoint,
} from "./control.js";

describe("job control", () => {
  it("throwIfCancelled after requestCancel", () => {
    ensureControl("j1");
    setExecutingJobId("j1");
    requestCancel("j1");
    assert.throws(() => throwIfCancelled("j1"), JobCancelledError);
    clearControl("j1");
    setExecutingJobId(null);
  });

  it("raceCancel rejects when cancelled", async () => {
    ensureControl("j2");
    setExecutingJobId("j2");
    const slow = new Promise<string>((r) => setTimeout(() => r("done"), 2000));
    setTimeout(() => requestCancel("j2"), 30);
    await assert.rejects(() => raceCancel(slow, "j2"), JobCancelledError);
    clearControl("j2");
    setExecutingJobId(null);
  });

  it("pause blocks checkpoint until resume", async () => {
    ensureControl("j3");
    setExecutingJobId("j3");
    requestPause("j3");
    let passed = false;
    const p = cooperativeCheckpoint("j3").then(() => {
      passed = true;
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(passed, false);
    requestResume("j3");
    await p;
    assert.equal(passed, true);
    clearControl("j3");
    setExecutingJobId(null);
  });

  it("raceCancel cleans up its poll timer when the op wins", async () => {
    ensureControl("j4");
    setExecutingJobId("j4");
    // The op resolves immediately every iteration; a leaked setInterval/waiter
    // would accumulate. After 50 runs no waiter should remain registered.
    for (let i = 0; i < 50; i++) {
      const result = await raceCancel(Promise.resolve("ok"), "j4");
      assert.equal(result, "ok");
    }
    assert.equal(debugWaiterCount("j4"), 0);
    clearControl("j4");
    setExecutingJobId(null);
  });

  it("keeps cancellation scoped across concurrent jobs", async () => {
    ensureControl("parallel-a");
    ensureControl("parallel-b");
    requestCancel("parallel-a");
    const [a, b] = await Promise.all([
      runWithJobControl("parallel-a", async () => {
        await Promise.resolve();
        assert.throws(() => throwIfCancelled(), JobCancelledError);
        return "cancelled";
      }),
      runWithJobControl("parallel-b", async () => {
        await Promise.resolve();
        assert.doesNotThrow(() => throwIfCancelled());
        return "ok";
      }),
    ]);
    assert.equal(a, "cancelled");
    assert.equal(b, "ok");
    clearControl("parallel-a");
    clearControl("parallel-b");
  });
});
