import assert from "node:assert/strict";
import test from "node:test";
import { graphTest } from "./app-map-test-operation-schemas.js";
import {
  SURVIVAL_FAMILY_ID,
  SURVIVAL_REQUIRED_DWELL_MS,
  THREE_MINUTE_MS,
  canCoverWorkbookFamily,
  destEndConnectionsAreChromeInspect,
  executionQueueForTest,
  isLoadingPlaceholderText,
  isPlaceholderPhaseId,
  quoteDeclaredExecutionQueues,
  sequenceAfterIsPlaceholder,
  wallTimeLowerBound,
} from "./execution-queue.js";

test("a Fast UI Test cannot inherit a 10s dwell and claim S16 60s coverage", () => {
  const inherited = canCoverWorkbookFamily({
    executionQueue: "fast-ui",
    declaredDwellMs: 10_000,
    family: SURVIVAL_FAMILY_ID,
  });
  assert.equal(inherited.ok, false);
  assert.match(inherited.reason, /S16/u);
  assert.match(inherited.reason, /60000/u);

  const shortSurvival = canCoverWorkbookFamily({
    executionQueue: "stateful-survival",
    declaredDwellMs: 10_000,
    family: SURVIVAL_FAMILY_ID,
  });
  assert.equal(shortSurvival.ok, false);
  assert.match(shortSurvival.reason, /10000ms dwell/u);

  assert.equal(
    canCoverWorkbookFamily({
      executionQueue: "stateful-survival",
      declaredDwellMs: SURVIVAL_REQUIRED_DWELL_MS,
      family: SURVIVAL_FAMILY_ID,
    }).ok,
    true,
  );
});

test("live-output Sequence after cannot be a loading placeholder", () => {
  assert.equal(isLoadingPlaceholderText("Working for 1s"), true);
  assert.equal(isLoadingPlaceholderText("Generating"), true);
  assert.equal(isLoadingPlaceholderText("Copy response"), false);
  assert.equal(isPlaceholderPhaseId("placeholder"), true);
  assert.equal(isPlaceholderPhaseId("after"), false);
  assert.equal(
    sequenceAfterIsPlaceholder({
      phase: "after",
      lookFor: "Working for 1s",
    }),
    true,
  );
  assert.equal(
    sequenceAfterIsPlaceholder({
      phases: [
        { id: "placeholder", caption: "Working", lookFor: "Working for 1s" },
        { id: "after", caption: "Final response", lookFor: "Copy response" },
      ],
    }),
    false,
  );
  assert.equal(
    sequenceAfterIsPlaceholder({
      phases: [{ id: "after", lookFor: "Generating" }],
    }),
    true,
  );
});

test("wall-time lower bound is max of critical path, work divided by workers, and dwell", () => {
  assert.equal(
    wallTimeLowerBound({
      criticalPathMs: 12_000,
      totalWorkMs: 180_000,
      workers: 3,
      requiredDwellMs: 0,
    }),
    60_000,
  );
  assert.equal(
    wallTimeLowerBound({
      criticalPathMs: 8_000,
      totalWorkMs: 30_000,
      workers: 3,
      requiredDwellMs: SURVIVAL_REQUIRED_DWELL_MS,
    }),
    SURVIVAL_REQUIRED_DWELL_MS,
  );
});

test("Combine duration quote lists the three queues separately when members declare them", () => {
  const quotes = quoteDeclaredExecutionQueues(
    [
      ...Array.from({ length: 30 }, () => ({
        executionQueue: "fast-ui" as const,
        workMs: 6_000,
      })),
      { executionQueue: "live-output", workMs: 45_000 },
      {
        executionQueue: "stateful-survival",
        workMs: 8_000,
        requiredDwellMs: SURVIVAL_REQUIRED_DWELL_MS,
      },
    ],
    3,
  );
  assert.deepEqual(
    quotes.map((quote) => quote.queue),
    ["fast-ui", "live-output", "stateful-survival"],
  );
  const fast = quotes.find((quote) => quote.queue === "fast-ui");
  const live = quotes.find((quote) => quote.queue === "live-output");
  const survival = quotes.find((quote) => quote.queue === "stateful-survival");
  assert.equal(fast?.workItemCount, 30);
  assert.equal(fast?.lowerBoundMs, 60_000);
  assert.equal(live?.lowerBoundMs, 45_000);
  assert.equal(survival?.requiredDwellMs, SURVIVAL_REQUIRED_DWELL_MS);
  assert.equal(survival?.lowerBoundMs, SURVIVAL_REQUIRED_DWELL_MS);
  assert.notEqual(fast?.lowerBoundMs, THREE_MINUTE_MS);
  assert.equal(
    canCoverWorkbookFamily({
      executionQueue: "fast-ui",
      declaredDwellMs: 10_000,
      family: SURVIVAL_FAMILY_ID,
    }).ok,
    false,
  );
});

test("default dest-end chrome inspect is Fast UI", () => {
  assert.equal(executionQueueForTest({ destEndChromeInspect: true }), "fast-ui");
  assert.equal(executionQueueForTest({ destEndChromeInspect: false }), undefined);
  assert.equal(
    executionQueueForTest({ executionQueue: "live-output", destEndChromeInspect: true }),
    "live-output",
  );
  assert.equal(
    destEndConnectionsAreChromeInspect([
      {
        destination: { kind: "end" },
        actions: [
          {
            kind: "steps",
            steps: [
              { kind: "wait-for" },
              { kind: "tap" },
              { kind: "wait-for" },
            ],
          },
        ],
      },
    ]),
    true,
  );
  assert.equal(
    destEndConnectionsAreChromeInspect([
      {
        destination: { kind: "end" },
        actions: [
          {
            kind: "steps",
            steps: [
              { kind: "wait-for" },
              { kind: "settings", action: "off" },
            ],
          },
        ],
      },
    ]),
    false,
  );
});

test("graph Test executionQueue is part of the existing Test schema", () => {
  assert.doesNotThrow(() =>
    graphTest.parse({
      name: "Settings inspect",
      kind: "scenario",
      intentSchemaVersion: 1,
      executionQueue: "fast-ui",
      steps: [
        {
          id: "open",
          intent: "Open Settings",
          kind: "module",
          binding: { status: "resolved", kind: "routine", routineId: "home-chrome" },
        },
      ],
    }),
  );
  assert.throws(
    () =>
      graphTest.parse({
        name: "Settings inspect",
        kind: "scenario",
        intentSchemaVersion: 1,
        executionQueue: "heavy-video",
        steps: [
          {
            id: "open",
            intent: "Open Settings",
            kind: "module",
            binding: { status: "resolved", kind: "routine", routineId: "home-chrome" },
          },
        ],
      }),
    /executionQueue/u,
  );
});
