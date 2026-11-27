import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  armCompensatingCleanup,
  compensatingCleanupIsArmed,
  JobCancelledError,
  clearControl,
  debugWaiterCount,
  disarmCompensatingCleanup,
  ensureControl,
  getControl,
  hardStopRequiresDeviceShutdown,
  raceCancel,
  requestCancel,
  requestPause,
  requestResume,
  runWithCancellationShield,
  runWithJobControl,
  setControlValidator,
  setExecutingJobId,
  throwIfCancelled,
  cooperativeCheckpoint,
} from "./control.js";

describe("job control", () => {
  it("only permits device-level hard-stop shutdown for physical iOS hardware", () => {
    assert.equal(
      hardStopRequiresDeviceShutdown({
        kind: "device",
        platform: "android",
        serial: "emulator-5554",
      }),
      false,
    );
    assert.equal(
      hardStopRequiresDeviceShutdown({
        kind: "device",
        platform: "ios",
        serial: "8D4C476A-5854-4D7B-BD26-E4D7A1475E03",
      }),
      false,
    );
    assert.equal(
      hardStopRequiresDeviceShutdown({
        kind: "device",
        platform: "ios",
        serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
      }),
      true,
    );
    assert.equal(
      hardStopRequiresDeviceShutdown({
        kind: "browser",
        platform: "browser",
        targetId: "chromium-local",
      }),
      false,
    );
  });

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

  it("shields only compensating work while preserving cancellation and ownership checks", async () => {
    let validations = 0;
    setControlValidator("cleanup", async () => {
      validations += 1;
    });
    requestCancel("cleanup");

    await runWithCancellationShield("cleanup", async () => {
      await cooperativeCheckpoint("cleanup");
      assert.doesNotThrow(() => throwIfCancelled("cleanup"));
      assert.equal(await raceCancel(Promise.resolve("restored"), "cleanup"), "restored");
    });

    assert.equal(validations, 1);
    assert.throws(() => throwIfCancelled("cleanup"), JobCancelledError);
    clearControl("cleanup");
  });

  it("does not shield compensating work from lost ownership", async () => {
    setControlValidator("cleanup-without-lease", async () => {
      throw new Error("Job control lease is no longer valid");
    });
    requestCancel("cleanup-without-lease");

    await assert.rejects(
      runWithCancellationShield("cleanup-without-lease", () =>
        cooperativeCheckpoint("cleanup-without-lease"),
      ),
      /lease is no longer valid/u,
    );
    clearControl("cleanup-without-lease");
  });

  it("arms cleanup only for the exact job and always clears it with control state", () => {
    armCompensatingCleanup("kids");
    assert.equal(compensatingCleanupIsArmed("kids"), true);
    assert.equal(compensatingCleanupIsArmed("other"), false);
    disarmCompensatingCleanup("kids");
    assert.equal(compensatingCleanupIsArmed("kids"), false);

    armCompensatingCleanup("kids");
    clearControl("kids");
    assert.equal(compensatingCleanupIsArmed("kids"), false);
  });

  it("drains an armed mutation before surfacing cancellation to cleanup", async () => {
    let finishMutation!: (value: string) => void;
    const mutation = new Promise<string>((resolve) => {
      finishMutation = resolve;
    });
    armCompensatingCleanup("ordered-cleanup");
    const raced = raceCancel(mutation, "ordered-cleanup");
    requestCancel("ordered-cleanup");
    let settled = false;
    void raced.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    assert.equal(settled, false, "cleanup cannot race an in-flight primary mutation");

    finishMutation("mutated");
    await assert.rejects(raced, JobCancelledError);
    clearControl("ordered-cleanup");
  });

  it("validates ownership before a checkpoint continues", async () => {
    let validations = 0;
    setControlValidator("owned", async () => {
      validations += 1;
    });
    await cooperativeCheckpoint("owned");
    assert.equal(validations, 1);
    clearControl("owned");
  });

  it("rejects an invalid lease before work starts", async () => {
    setControlValidator("expired", async () => {
      throw new Error("Job control lease is no longer valid");
    });
    await assert.rejects(cooperativeCheckpoint("expired"), /Job control lease is no longer valid/u);
    clearControl("expired");
  });

  it("detects release or takeover at the next checkpoint", async () => {
    let valid = true;
    setControlValidator("handoff", async () => {
      if (!valid) throw new Error("Job control lease is no longer valid");
    });
    await cooperativeCheckpoint("handoff");
    valid = false;
    await assert.rejects(cooperativeCheckpoint("handoff"), /Job control lease is no longer valid/u);
    clearControl("handoff");
  });

  it("leaves jobs without an exclusive lease unchanged and clears validators", async () => {
    await assert.doesNotReject(cooperativeCheckpoint("browser-without-lease"));
    setControlValidator("cleared", async () => {
      throw new Error("stale validator");
    });
    clearControl("cleared");
    assert.equal(getControl("cleared"), undefined);
    await assert.doesNotReject(cooperativeCheckpoint("cleared"));
  });
});
