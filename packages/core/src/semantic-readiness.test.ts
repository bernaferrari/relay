import assert from "node:assert/strict";
import test from "node:test";
import {
  attachExpectedLabels,
  awaitSemanticReadiness,
  collectExpectedSemanticLabels,
  SemanticReadinessTimeoutError,
  semanticSnapshotDigest,
} from "./semantic-readiness.js";

function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

test("awaitSemanticReadiness succeeds when a later snapshot has every expected label", async () => {
  const snapshots = [
    { nodes: [] },
    { labels: ["Home"] },
    { nodes: [{ label: "Settings" }, { label: "Data Controls" }] },
  ];
  let captures = 0;
  const time = clock();
  const result = await awaitSemanticReadiness({
    captureSnapshot: async () => snapshots[captures++] ?? { nodes: [] },
    expectedLabels: ["Settings", "Data Controls"],
    timeoutMs: 5_000,
    retry: { delayMs: 10, maxDelayMs: 10 },
    now: time.now,
    sleep: time.sleep,
  });
  assert.equal(result.ready, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.matchedLabels, ["Settings", "Data Controls"]);
  assert.deepEqual(result.lastLabels, ["Settings", "Data Controls"]);
  assert.equal(captures, 3);
});

test("awaitSemanticReadiness times out with screenshot, digest, and last labels", async () => {
  const time = clock();
  let captures = 0;
  await assert.rejects(
    () =>
      awaitSemanticReadiness({
        captureSnapshot: async () => {
          captures += 1;
          return {
            nodes: [{ label: "Home" }, { value: "Menu" }],
            screenshotPath: "/tmp/locale-timeout.png",
          };
        },
        expectedLabels: ["Settings", "Data Controls"],
        timeoutMs: 40,
        retry: { delayMs: 10, maxDelayMs: 10 },
        now: time.now,
        sleep: time.sleep,
      }),
    (error: unknown) => {
      assert.ok(error instanceof SemanticReadinessTimeoutError);
      assert.deepEqual(error.expectedLabels, ["Settings", "Data Controls"]);
      assert.deepEqual(error.missingLabels, ["Settings", "Data Controls"]);
      assert.deepEqual(error.lastLabels, ["Home", "Menu"]);
      assert.equal(error.screenshotPath, "/tmp/locale-timeout.png");
      assert.equal(error.digest, semanticSnapshotDigest(["Home", "Menu"]));
      assert.match(error.message, /screenshot: \/tmp\/locale-timeout\.png/);
      assert.match(error.message, /digest: /);
      assert.match(error.message, /last: Home, Menu/);
      return true;
    },
  );
  assert.ok(captures >= 1);
});

test("awaitSemanticReadiness does not exceed the attempt budget", async () => {
  const time = clock();
  let captures = 0;
  await assert.rejects(
    () =>
      awaitSemanticReadiness({
        captureSnapshot: async () => {
          captures += 1;
          return { nodes: [] };
        },
        expectedLabels: ["Settings"],
        timeoutMs: 60_000,
        retry: { delayMs: 10, maxDelayMs: 10, maxAttempts: 4 },
        now: time.now,
        sleep: time.sleep,
      }),
    SemanticReadinessTimeoutError,
  );
  assert.equal(captures, 4);
});

test("collectExpectedSemanticLabels keeps a short unique list and drops blanks", () => {
  assert.deepEqual(
    collectExpectedSemanticLabels({
      screenTitle: "Settings",
      observationLabels: ["Settings", "  Data Controls  ", "", undefined],
      optionLabels: ["-", "Italiano"],
    }),
    ["Settings", "Data Controls", "Italiano"],
  );
});

test("attachExpectedLabels is a no-op without usable labels", () => {
  const open = { kind: "app" as const, action: "open" as const, app: "com.example" };
  assert.equal(attachExpectedLabels(open, ["-", "  "]), open);
  assert.deepEqual(attachExpectedLabels({ ...open }, ["Settings"]), {
    ...open,
    expectedLabels: ["Settings"],
  });
});
