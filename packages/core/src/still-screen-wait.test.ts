import assert from "node:assert/strict";
import test from "node:test";
import {
  RECIPE_WAIT_DEFAULT_MS,
  RECIPE_WAIT_SLICE_MS,
  STILL_SCREEN_NEXT_HINT,
  boundRecipeWaitMs,
  stillScreenTimeoutMessage,
  stillScreenUnchanged,
  waitForTargetVisible,
  type WaitForReadinessTiming,
} from "./still-screen-wait.js";
import { isIosRunnerPresenceDrainError } from "./ios-runtime-recovery.js";

test("default wait-for budget is short and still-screen compare is exact", () => {
  assert.equal(RECIPE_WAIT_DEFAULT_MS, 8_000);
  assert.equal(RECIPE_WAIT_SLICE_MS, 800);
  assert.equal(boundRecipeWaitMs(undefined), 8_000);
  assert.equal(boundRecipeWaitMs(90_000), 90_000);
  assert.equal(stillScreenUnchanged(undefined, "abc"), false);
  assert.equal(stillScreenUnchanged("abc", "abc"), true);
  assert.equal(stillScreenUnchanged("abc", "def"), false);
});

test("timeout copy names elapsed time and treats still pixels as diagnostic", () => {
  const waitFor = stillScreenTimeoutMessage({
    kind: "wait-for",
    expected: 'label "Ask"',
    elapsedMs: 1_640,
    timeoutMs: 8_000,
    pixelsUnchanged: true,
  });
  assert.match(waitFor, /wait-for: timed out waiting for label "Ask"/u);
  assert.match(waitFor, /8000ms/u);
  assert.match(waitFor, /pixels unchanged for 1640ms/u);
  assert.equal(waitFor.includes(STILL_SCREEN_NEXT_HINT), true);
  assert.equal(waitFor.includes("Do not retry wait-for"), false);

  const screen = stillScreenTimeoutMessage({
    kind: "expect-screen",
    expected: "Search",
    observed: "unknown",
    elapsedMs: 2_100,
    timeoutMs: 5_000,
    pixelsUnchanged: true,
  });
  assert.match(screen, /expect-screen: on “unknown”, not “Search”/u);
  assert.match(screen, /after 5000ms/u);
  assert.match(screen, /pixels unchanged for 2100ms/u);

  const response = stillScreenTimeoutMessage({
    kind: "wait-response",
    expected: 'label "15"',
    elapsedMs: 1_200,
    timeoutMs: 90_000,
    pixelsUnchanged: true,
  });
  assert.match(response, /wait-response: timed out waiting for label "15"/u);
  assert.match(response, /90000ms/u);
});

test("a still loading screen that becomes ready at 1.5s uses the 8s wait budget", async () => {
  let nowMs = 0;
  await waitForTargetVisible({
    present: async () => nowMs >= 1_500,
    captureFingerprint: async () => "still",
    sleep: async (ms) => {
      nowMs += ms;
    },
    now: () => nowMs,
    timeoutMs: 8_000,
    kind: "wait-for",
    expected: 'label "Save"',
  });
  assert.ok(nowMs >= 1_500);
  assert.ok(nowMs < 8_000);
});

test("wait-for keeps polling a still screen until the target appears inside the budget", async () => {
  const logs: string[] = [];
  const sleeps: number[] = [];
  let presentCalls = 0;
  let nowMs = 0;
  await waitForTargetVisible({
    present: async () => {
      presentCalls += 1;
      return presentCalls >= 4;
    },
    captureFingerprint: async () => "still",
    sleep: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    now: () => nowMs,
    timeoutMs: 8_000,
    kind: "wait-for",
    expected: 'identifier "ask.toolbar.textfield"',
    log: (message) => logs.push(message),
  });
  assert.ok(presentCalls >= 4);
  assert.ok(sleeps.length >= 2);
  assert.equal(
    sleeps.every((ms) => ms <= RECIPE_WAIT_SLICE_MS),
    true,
  );
  assert.ok(logs.some((line) => line.includes("pixels unchanged")));
});

test("wait-for times out at the authored budget when the target never appears", async () => {
  let nowMs = 0;
  await assert.rejects(
    () =>
      waitForTargetVisible({
        present: async () => false,
        captureFingerprint: async () => "still",
        sleep: async (ms) => {
          nowMs += ms;
        },
        now: () => nowMs,
        timeoutMs: 8_000,
        kind: "wait-for",
        expected: 'label "Ask"',
      }),
    /timed out waiting for label "Ask" \(8000ms\).*pixels unchanged/u,
  );
  assert.ok(nowMs >= 8_000);
});

test("wait-for retries XCTest runner-busy until the identifier is present", async () => {
  let nowMs = 0;
  let presentCalls = 0;
  const logs: string[] = [];
  await waitForTargetVisible({
    present: async () => {
      presentCalls += 1;
      if (presentCalls < 3) {
        throw new Error(
          "The iOS runner is still finishing a previous command that exceeded its execution watchdog",
        );
      }
      return true;
    },
    captureFingerprint: async () => {
      throw new Error("do not snapshot while the runner is busy");
    },
    sleep: async (ms) => {
      nowMs += ms;
    },
    now: () => nowMs,
    timeoutMs: 8_000,
    kind: "wait-for",
    expected: 'identifier "ask.toolbar.textfield"',
    log: (line) => logs.push(line),
    isTransientPresenceError: (error) =>
      /still finishing a previous command/i.test(error instanceof Error ? error.message : ""),
    transientBudgetMs: 45_000,
    transientSleepMs: 2_000,
  });
  assert.equal(presentCalls, 3);
  assert.ok(nowMs >= 4_000);
  assert.ok(nowMs < 8_000);
  assert.ok(logs.some((line) => line.includes("runner still finishing a previous command")));
});

test("wait-for rethrows runner-busy after the drain budget", async () => {
  let nowMs = 0;
  await assert.rejects(
    () =>
      waitForTargetVisible({
        present: async () => {
          throw new Error(
            "The iOS runner is still finishing a previous command that exceeded its execution watchdog",
          );
        },
        captureFingerprint: async () => "still",
        sleep: async (ms) => {
          nowMs += ms;
        },
        now: () => nowMs,
        timeoutMs: 8_000,
        kind: "wait-for",
        expected: 'identifier "ask.toolbar.textfield"',
        isTransientPresenceError: (error) =>
          /still finishing a previous command/i.test(error instanceof Error ? error.message : ""),
        transientBudgetMs: 6_000,
        transientSleepMs: 2_000,
      }),
    /still finishing a previous command/u,
  );
  assert.ok(nowMs >= 6_000);
});

test("wait-for keeps polling while pixels change and returns when the target appears", async () => {
  let presentCalls = 0;
  const fingerprints = ["a", "b", "c"];
  await waitForTargetVisible({
    present: async () => {
      presentCalls += 1;
      return presentCalls >= 3;
    },
    captureFingerprint: async () => fingerprints.shift() ?? "c",
    sleep: async () => undefined,
    timeoutMs: 8_000,
    kind: "wait-for",
    expected: 'label "Library"',
  });
  assert.ok(presentCalls >= 3);
});

test("runner-busy drain is runner-recover ms, not dest-wait product-ready time", async () => {
  let nowMs = 0;
  let presentCalls = 0;
  const timing = await waitForTargetVisible({
    present: async () => {
      presentCalls += 1;
      if (presentCalls < 3) {
        throw new Error(
          "The iOS runner is still finishing a previous command that exceeded its execution watchdog",
        );
      }
      return true;
    },
    captureFingerprint: async () => {
      throw new Error("do not snapshot while the runner is busy");
    },
    sleep: async (ms) => {
      nowMs += ms;
    },
    now: () => nowMs,
    timeoutMs: 8_000,
    kind: "wait-for",
    expected: 'identifier "ask.toolbar.textfield"',
    isTransientPresenceError: (error) =>
      /still finishing a previous command/i.test(error instanceof Error ? error.message : ""),
    transientBudgetMs: 45_000,
    transientSleepMs: 2_000,
  });
  assert.equal(presentCalls, 3);
  assert.ok(timing.runnerRecoverMs >= 4_000);
  assert.ok(timing.destWaitMs < timing.runnerRecoverMs);
  assert.equal(timing.productReadyMs, timing.destWaitMs);
  assert.notEqual(timing.runnerRecoverMs, timing.productReadyMs);
});

test("a probe timeout drain is not product dwell", async () => {
  let nowMs = 0;
  await assert.rejects(
    () =>
      waitForTargetVisible({
        present: async () => {
          throw new Error("xcrun timed out");
        },
        captureFingerprint: async () => "still",
        sleep: async (ms) => {
          nowMs += ms;
        },
        now: () => nowMs,
        timeoutMs: 8_000,
        kind: "wait-for",
        expected: 'identifier "ask.toolbar.textfield"',
        isTransientPresenceError: isIosRunnerPresenceDrainError,
        transientBudgetMs: 15_000,
        transientSleepMs: 5_000,
      }),
    (error: unknown) => {
      assert.match(error instanceof Error ? error.message : "", /xcrun timed out/u);
      const timing = (error as { iosReadiness?: WaitForReadinessTiming }).iosReadiness;
      assert.ok(timing);
      assert.ok(timing.runnerRecoverMs >= 15_000);
      assert.equal(timing.productReadyMs, 0);
      assert.ok(timing.destWaitMs < 15_000);
      return true;
    },
  );
});
