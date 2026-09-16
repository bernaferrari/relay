import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapEntity, AppMapScenarioTest, Connection, Screen } from "@relay/protocol";
import {
  SURVIVAL_FAMILY_ID,
  SURVIVAL_REQUIRED_DWELL_MS,
  canCoverWorkbookFamily,
} from "@relay/protocol";
import { AppMapTestCompileError } from "./app-map-test-compile-error.js";
import { preflightAppMapCombine } from "./app-map-combine-preflight.js";
import { compileAppMapTest } from "./map-work.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "checkout" };

function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}

function screen(id: string): Screen {
  return {
    ...entity(id),
    title: id,
    identity: { schemaVersion: 1, fingerprint: (id === "home" ? "a" : "b").repeat(64) },
    variantIds: [],
  };
}

function inspectConnection(): Connection {
  return {
    ...entity("open-settings-panel"),
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
  };
}

function inspectTest(): AppMapScenarioTest {
  return {
    ...entity("settings-inspect"),
    name: "Settings inspect",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open-settings-panel",
        kind: "instruction",
        intent: "Open settings panel",
        capture: true,
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-settings-panel"],
        },
      },
    ],
  };
}

function liveOutputTest(): AppMapScenarioTest {
  return {
    ...entity("live-reply"),
    name: "Live reply",
    kind: "scenario",
    intentSchemaVersion: 1,
    executionQueue: "live-output",
    steps: [
      {
        id: "reply",
        kind: "validation",
        intent: "Capture the final response",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: {
            id: "reply",
            kind: "screenshot",
            caption: "Response",
            review: {
              mode: "later",
              policy: "sequence",
              lookFor: "Copy response",
              phases: [
                { id: "placeholder", caption: "Working", lookFor: "Working for 1s" },
                { id: "after", caption: "Final response", lookFor: "Copy response" },
              ],
            },
          },
        },
      },
    ],
  };
}

function survivalTest(): AppMapScenarioTest {
  return {
    ...entity("interrupt"),
    name: "Interrupt",
    kind: "scenario",
    intentSchemaVersion: 1,
    executionQueue: "stateful-survival",
    steps: [
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
              phases: [
                { id: "before", caption: "Before airplane" },
                { id: "during", caption: "During airplane", intervalMs: SURVIVAL_REQUIRED_DWELL_MS },
              ],
            },
          },
        },
      },
    ],
  };
}

function queueMap(tests: Record<string, AppMapScenarioTest>): AppMap {
  return {
    schemaVersion: 1,
    id: "checkout",
    organizationId: "org",
    projectId: "project",
    name: "Checkout",
    revision: 7,
    notes: {},
    groups: {},
    screens: { home: screen("home") },
    screenVariants: {},
    connections: { "open-settings-panel": inspectConnection() },
    caseStacks: {},
    variables: {
      language: {
        ...entity("language"),
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [{ id: "en", label: "English" }],
        restoreId: "en",
      },
    },
    tests,
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("default dest-end chrome inspect is Fast UI and cannot claim S16 with a 10s dwell", () => {
  const map = queueMap({ "settings-inspect": inspectTest() });
  const compiled = compileAppMapTest(map, inspectTest());
  assert.equal(compiled.plan.executionQueue, "fast-ui");
  const screenshot = compiled.root.steps.find((step) => step.kind === "screenshot");
  assert.equal(screenshot?.kind === "screenshot" ? screenshot.review?.policy : undefined, "fast");
  assert.equal(
    canCoverWorkbookFamily({
      executionQueue: compiled.plan.executionQueue,
      declaredDwellMs: 10_000,
      family: SURVIVAL_FAMILY_ID,
    }).ok,
    false,
  );
});

test("live-output compile rejects a loading placeholder as Sequence after", () => {
  const illegal = liveOutputTest();
  const step = illegal.steps[0]!;
  assert.equal(step.kind, "validation");
  if (step.kind !== "validation" || step.binding.kind !== "recipe-step") {
    throw new Error("expected recipe-step screenshot");
  }
  step.binding = {
    status: "resolved",
    kind: "recipe-step",
    step: {
      id: "reply",
      kind: "screenshot",
      caption: "Final response",
      review: {
        mode: "later",
        policy: "sequence",
        phase: "after",
        lookFor: "Working for 1s",
        phases: [{ id: "after", caption: "Working", lookFor: "Working for 1s" }],
      },
    },
  };
  assert.throws(
    () => compileAppMapTest(queueMap({ "live-reply": illegal }), illegal),
    (error: unknown) =>
      error instanceof Error && /loading placeholder/u.test(error.message),
  );
});

test("Combine/plan duration quote lists the three queues separately when members declare them", async () => {
  const tests = {
    "settings-inspect": inspectTest(),
    "live-reply": liveOutputTest(),
    interrupt: survivalTest(),
  };
  const map = queueMap(tests);
  const combine = {
    ...entity("queues"),
    name: "Queue pack",
    variableIds: ["language"],
    testIds: ["settings-inspect", "live-reply", "interrupt"],
    cellRuntimeProfiles: [
      {
        testId: "settings-inspect",
        values: { language: "en" },
        targetProfileId: "pixel-en",
      },
      { testId: "live-reply", values: { language: "en" }, targetProfileId: "pixel-en" },
      { testId: "interrupt", values: { language: "en" }, targetProfileId: "pixel-en" },
    ],
  };
  map.combines = { queues: combine };
  const preflight = await preflightAppMapCombine(map, combine);
  assert.equal(preflight.ok, true, JSON.stringify(preflight.blockers));
  assert.deepEqual(
    preflight.queueQuotes?.map((quote) => quote.queue),
    ["fast-ui", "live-output", "stateful-survival"],
  );
  const fast = preflight.queueQuotes?.find((quote) => quote.queue === "fast-ui");
  const survival = preflight.queueQuotes?.find((quote) => quote.queue === "stateful-survival");
  assert.ok(fast);
  assert.equal(survival?.requiredDwellMs, SURVIVAL_REQUIRED_DWELL_MS);
  assert.ok((survival?.lowerBoundMs ?? 0) >= SURVIVAL_REQUIRED_DWELL_MS);
  assert.notEqual(fast?.lowerBoundMs, survival?.lowerBoundMs);
  assert.equal(
    canCoverWorkbookFamily({
      executionQueue: "fast-ui",
      declaredDwellMs: 10_000,
      family: SURVIVAL_FAMILY_ID,
    }).ok,
    false,
  );
  assert.equal(preflight.blockers.some((item) => item.code === "unsafe-execution-queue"), false);
  assert.equal(
    compileAppMapTest(map, inspectTest()).plan.executionQueue === "fast-ui" &&
      compileAppMapTest(map, liveOutputTest()).plan.executionQueue === "live-output" &&
      compileAppMapTest(map, survivalTest()).plan.executionQueue === "stateful-survival",
    true,
  );
  assert.equal(new AppMapTestCompileError("unsafe-execution-queue", "x", "y", "z").code, "unsafe-execution-queue");
});
