import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTransientError, withRetry } from "./retry.js";
import {
  JobCancelledError,
  clearControl,
  ensureControl,
  requestCancel,
  setExecutingJobId,
} from "./control.js";

describe("retry", () => {
  it("classifies transient errors", () => {
    assert.equal(isTransientError(new Error("element not found")), true);
    assert.equal(isTransientError(new Error("Timed out waiting")), true);
    assert.equal(isTransientError(new JobCancelledError()), false);
    assert.equal(isTransientError(new Error("PROD_ACCOUNT_MATCH is required")), false);
  });

  it("retries then succeeds", async () => {
    let n = 0;
    const v = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error("not found");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 10 },
    );
    assert.equal(v, "ok");
    assert.equal(n, 3);
  });

  it("aborts retry on cancel", async () => {
    ensureControl("rt1");
    setExecutingJobId("rt1");
    let n = 0;
    const p = withRetry(
      async () => {
        n += 1;
        throw new Error("not found");
      },
      { attempts: 5, baseDelayMs: 50 },
    );
    setTimeout(() => requestCancel("rt1"), 20);
    await assert.rejects(() => p, JobCancelledError);
    clearControl("rt1");
    setExecutingJobId(null);
    assert.ok(n >= 1);
  });
});
