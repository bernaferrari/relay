import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JobCancelledError,
  clearControl,
  ensureControl,
  raceCancel,
  requestCancel,
  requestPause,
  requestResume,
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
});
