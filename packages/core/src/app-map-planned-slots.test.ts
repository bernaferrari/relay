import assert from "node:assert/strict";
import test from "node:test";
import {
  captureReviewCheckpointFamilyId,
  captureReviewSlotId,
  type AppMap,
  type AppMapScenarioTest,
  type Screen,
} from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import { applyCaptureReviewDecision, captureReviewQueueForRun } from "./capture-review.js";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "checkout" };

function screen(id: string): Screen {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1, fingerprint: (id === "home" ? "a" : "b").repeat(64) },
    variantIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function destEndReviewMap(): AppMap {
  return {
    schemaVersion: 1,
    id: "checkout",
    organizationId: "org",
    projectId: "project",
    name: "Checkout",
    revision: 7,
    notes: {},
    groups: {},
    screens: { home: screen("home"), cart: screen("cart") },
    screenVariants: {},
    connections: {
      "open-settings-panel": {
        ...scope,
        id: "open-settings-panel",
        fromScreenId: "home",
        destination: { kind: "end" },
        label: "Open settings panel",
        state: "ready",
        actions: [
          {
            id: "open-settings",
            kind: "steps",
            steps: [
              { kind: "wait-for", target: { identifier: "composer" }, timeoutMs: 8_000 },
              { kind: "tap", target: { identifier: "sidebar.settings" } },
              { kind: "wait-for", target: { identifier: "settings.account" }, timeoutMs: 8_000 },
            ],
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {
      "settings-inventory": {
        ...scope,
        id: "settings-inventory",
        name: "Settings inventory",
        parameters: [],
        actions: [
          {
            id: "capture-account",
            kind: "steps",
            steps: [
              {
                id: "settings-en",
                kind: "screenshot",
                caption: "Account",
                review: { mode: "later", lookFor: "Account section" },
              },
            ],
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

function destEndReviewTest(): AppMapScenarioTest {
  return {
    ...scope,
    id: "review-settings",
    name: "Review settings",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open-panel",
        kind: "instruction",
        intent: "Open the in-place settings panel",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-settings-panel"],
        },
      },
      {
        id: "settings-before-language",
        kind: "validation",
        intent: "Capture Settings before the language change",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: {
            id: "settings-before-language",
            kind: "screenshot",
            caption: "Settings",
            review: { mode: "later", lookFor: "English section list" },
          },
        },
      },
      {
        id: "settings-after-language",
        kind: "validation",
        intent: "Capture Settings after the language change",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: {
            id: "settings-after-language",
            kind: "screenshot",
            caption: "Settings",
            review: { mode: "later", lookFor: "Arabic section list" },
          },
        },
      },
      {
        id: "inventory",
        kind: "module",
        intent: "Capture the nested account inventory",
        binding: { status: "resolved", kind: "routine", routineId: "settings-inventory" },
      },
      {
        id: "language-loop",
        kind: "loop",
        intent: "Capture each language row",
        binding: { status: "resolved", kind: "repeat", count: 3 },
        steps: [
          {
            id: "language-row",
            kind: "validation",
            intent: "Language settings",
            binding: {
              status: "resolved",
              kind: "recipe-step",
              step: {
                id: "language-row",
                kind: "screenshot",
                caption: "Language",
                review: { mode: "later", lookFor: "Language row" },
              },
            },
          },
        ],
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

test("compiled dest-end review plans freeze every capture slot before execution", () => {
  const compiled = compileAppMapTest(destEndReviewMap(), destEndReviewTest());
  assert.ok(compiled.plan.destEndRecipeIds?.length);
  assert.equal(
    Object.values(compiled.graph).some((recipe) =>
      recipe.steps.some(
        (step) =>
          (step.kind === "wait-for" || step.kind === "tap") && step.when?.condition === "absent",
      ),
    ),
    true,
  );
  const planned = compiled.plan.plannedSlots;
  assert.ok(planned);
  assert.equal(planned.length, 6);
  assert.equal(
    planned.every((slot) => slot.requirementId === "review-settings"),
    true,
  );
  const settings = planned.filter((slot) => slot.caption === "Settings");
  assert.equal(settings.length, 2);
  assert.equal(settings[0]?.checkpointId, "settings-before-language");
  assert.equal(settings[1]?.checkpointId, "settings-after-language");
  assert.equal(settings[0]?.attempt, 1);
  assert.equal(settings[1]?.attempt, 1);
  assert.notEqual(captureReviewSlotId(settings[0]!), captureReviewSlotId(settings[1]!));
  const nested = planned.find((slot) => slot.invocation?.includes("module:"));
  assert.equal(nested?.caption, "Account");
  assert.equal(nested?.checkpointId, "settings-en");
  const loopSlots = planned.filter((slot) => slot.iteration !== undefined);
  assert.equal(loopSlots.length, 3);
  assert.deepEqual(
    loopSlots.map((slot) => slot.iteration),
    [0, 1, 2],
  );
  assert.equal(new Set(planned.map((slot) => captureReviewSlotId(slot))).size, planned.length);
});

test("a partial dest-end review run keeps the frozen plannedSlots denominator", () => {
  const compiled = compileAppMapTest(destEndReviewMap(), destEndReviewTest());
  const planned = compiled.plan.plannedSlots ?? [];
  const before = planned.find((slot) => slot.checkpointId === "settings-before-language");
  const loopFirst = planned.find(
    (slot) => slot.checkpointId === "language-row" && slot.iteration === 0,
  );
  assert.ok(before);
  assert.ok(loopFirst);
  const intent = createAppMapTestExecutionIntent({
    plan: compiled.plan,
    recipeGraph: compiled.graph,
    preflight: preflightCompiledAppMapTestOffline(compiled.plan),
  });
  const queue = captureReviewQueueForRun({
    artifacts: [
      { kind: "app-map-test-execution-intent", capturedAt: 1, data: intent },
      {
        kind: "capture-review",
        capturedAt: 2,
        data: {
          caption: "Settings",
          framePath: "frames/001.png",
          imageSha256: "before",
          slotId: captureReviewSlotId(before),
          stepId: before.stepId,
          checkpointId: before.checkpointId,
          invocation: before.invocation,
        },
      },
      {
        kind: "capture-review",
        capturedAt: 3,
        data: {
          caption: "Language",
          framePath: "frames/002.png",
          imageSha256: "en",
          slotId: captureReviewSlotId(loopFirst),
          stepId: loopFirst.stepId,
          checkpointId: loopFirst.checkpointId,
          invocation: loopFirst.invocation,
          iteration: loopFirst.iteration,
        },
      },
    ],
    recipeSnapshot: {
      steps: compiled.root.steps,
    },
  });
  assert.equal(queue.items.length, planned.length);
  const reconstructed = captureReviewQueueForRun({
    artifacts: [],
    recipeSnapshot: { steps: compiled.root.steps },
  });
  assert.equal(
    reconstructed.items.some((item) => item.checkpointId === "settings-en"),
    false,
  );
  assert.notDeepEqual(
    reconstructed.items.map((item) => item.slotId),
    planned.map((slot) => captureReviewSlotId(slot)),
  );
  assert.equal(queue.summary.captured, 2);
  assert.equal(queue.summary.missing, 4);
  assert.equal(
    queue.items.find((item) => item.checkpointId === "settings-before-language")?.status,
    "pending",
  );
  assert.equal(
    queue.items.find((item) => item.checkpointId === "settings-after-language")?.status,
    "missing",
  );
  assert.equal(queue.items.find((item) => item.invocation?.includes("module:"))?.status, "missing");
  assert.deepEqual(
    queue.items.filter((item) => item.checkpointId === "language-row").map((item) => item.status),
    ["pending", "missing", "missing"],
  );
  assert.throws(
    () =>
      applyCaptureReviewDecision(
        {
          artifacts: [{ kind: "app-map-test-execution-intent", capturedAt: 1, data: intent }],
          recipeSnapshot: { steps: compiled.root.steps },
        },
        {
          captureId: queue.items.find((item) => item.checkpointId === "settings-after-language")!
            .captureId,
          action: "accept",
          actor: { id: "human:maria", kind: "human" },
        },
      ),
    (error: unknown) => error instanceof Error && error.message.includes("missing"),
  );
});

test("compiled dest-end sequence plans freeze two named phases", () => {
  const compiled = compileAppMapTest(destEndReviewMap(), {
    ...destEndReviewTest(),
    id: "review-survival",
    name: "Review survival",
    steps: [
      destEndReviewTest().steps[0]!,
      {
        id: "interrupt",
        kind: "validation",
        intent: "Capture before and during the outage",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: {
            id: "interrupt",
            kind: "screenshot",
            caption: "Survival",
            review: {
              mode: "later",
              policy: "sequence",
              lookFor: "Composer still reachable",
              phases: [
                { id: "before", caption: "Before airplane", lookFor: "Signed-in home" },
                {
                  id: "during",
                  caption: "During airplane",
                  lookFor: "Reconnect or offline chrome",
                  intervalMs: 60_000,
                },
              ],
            },
          },
        },
      },
    ],
  } as AppMapScenarioTest);
  const planned = compiled.plan.plannedSlots ?? [];
  const sequence = planned.filter((slot) => slot.checkpointId === "interrupt");
  assert.equal(sequence.length, 2);
  assert.deepEqual(
    sequence.map((slot) => slot.phase),
    ["before", "during"],
  );
  assert.equal(
    captureReviewCheckpointFamilyId(sequence[0]!),
    captureReviewCheckpointFamilyId(sequence[1]!),
  );
  assert.notEqual(captureReviewSlotId(sequence[0]!), captureReviewSlotId(sequence[1]!));
  assert.equal(sequence[1]?.intervalMs, 60_000);
  assert.doesNotThrow(() =>
    createAppMapTestExecutionIntent({
      plan: compiled.plan,
      recipeGraph: compiled.graph,
      preflight: preflightCompiledAppMapTestOffline(compiled.plan),
    }),
  );
});
