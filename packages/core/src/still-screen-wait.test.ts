import assert from "node:assert/strict";
import test from "node:test";
import {
  RECIPE_WAIT_DEFAULT_MS,
  RECIPE_WAIT_SLICE_MS,
  STILL_SCREEN_NEXT_HINT,
  boundRecipeWaitMs,
  stillScreenAbortMessage,
  stillScreenUnchanged,
  waitForTargetVisible,
} from "./still-screen-wait.js";

test("default wait-for budget is short and still-screen compare is exact", () => {
  assert.equal(RECIPE_WAIT_DEFAULT_MS, 8_000);
  assert.equal(RECIPE_WAIT_SLICE_MS, 800);
  assert.equal(boundRecipeWaitMs(undefined), 8_000);
  assert.equal(boundRecipeWaitMs(90_000), 90_000);
  assert.equal(stillScreenUnchanged(undefined, "abc"), false);
  assert.equal(stillScreenUnchanged("abc", "abc"), true);
  assert.equal(stillScreenUnchanged("abc", "def"), false);
});

test("abort copy names elapsed time and the screenshot+interact next step", () => {
  const waitFor = stillScreenAbortMessage({
    kind: "wait-for",
    expected: 'label "Ask"',
    elapsedMs: 1_640,
    timeoutMs: 90_000,
  });
  assert.match(waitFor, /wait-for: timed out waiting for label "Ask"/u);
  assert.match(waitFor, /pixels unchanged after 1640ms/u);
  assert.match(waitFor, /budget 90000ms/u);
  assert.match(waitFor, /Screenshot \+ interact/u);
  assert.equal(waitFor.includes(STILL_SCREEN_NEXT_HINT), true);

  const screen = stillScreenAbortMessage({
    kind: "expect-screen",
    expected: "Search",
    observed: "unknown",
    elapsedMs: 2_100,
    timeoutMs: 5_000,
  });
  assert.match(screen, /expect-screen: on “unknown”, not “Search”/u);
  assert.match(screen, /pixels unchanged after 2100ms/u);
  assert.match(screen, /Do not retry wait-for, expect-screen, or test run/u);

  const response = stillScreenAbortMessage({
    kind: "wait-response",
    expected: 'label "15"',
    elapsedMs: 1_200,
    timeoutMs: 90_000,
  });
  assert.match(response, /wait-response: timed out waiting for label "15"/u);
  assert.match(response, /pixels unchanged after 1200ms/u);
  assert.match(response, /budget 90000ms/u);
});

test("wait-for aborts on the second identical pixel sample instead of the full budget", async () => {
  const sleeps: number[] = [];
  const fingerprints = ["still", "still"];
  let nowMs = 1_000;
  await assert.rejects(
    () =>
      waitForTargetVisible({
        present: async () => false,
        captureFingerprint: async () => fingerprints.shift() ?? "still",
        sleep: async (ms) => {
          sleeps.push(ms);
          nowMs += ms;
        },
        now: () => nowMs,
        timeoutMs: 90_000,
        kind: "wait-for",
        expected: 'label "Ask"',
      }),
    /pixels unchanged after 800ms; budget 90000ms/u,
  );
  assert.deepEqual(sleeps, [800]);
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
