import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, Screen } from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import { AppMapTestCompileError } from "./app-map-test-compiler.js";
import { compiledTestClaimedAbsentControl } from "./app-map-unrecorded-claimed-control.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "grok-web" };

function screen(id: string): Screen {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    variantIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function map(): AppMap {
  return {
    schemaVersion: 1,
    id: "grok-web",
    organizationId: "org",
    projectId: "project",
    name: "Grok.com daily",
    revision: 7,
    notes: {},
    groups: {},
    screens: { home: screen("home") },
    screenVariants: {},
    connections: {
      "older-chat": {
        ...scope,
        id: "older-chat",
        fromScreenId: "home",
        destination: { kind: "end" },
        label: "Older conversation then 2+2",
        state: "ready",
        actions: [
          {
            id: "older-chat-steps",
            kind: "steps",
            steps: [
              { id: "tap-row", kind: "tap", target: { label: "3x5 equals 15" } },
              {
                as: "answer",
                id: "extract-answer",
                kind: "extract",
                role: "assistant",
                target: { identifier: "assistant-message" },
              },
              {
                expected: "4",
                id: "assert-4",
                input: "answer",
                kind: "assert-content",
                match: "number-equals",
              },
            ],
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
      "more-header": {
        ...scope,
        id: "more-header",
        fromScreenId: "home",
        destination: { kind: "end" },
        label: "Header More on existing chat",
        state: "ready",
        actions: [
          {
            id: "more-header-steps",
            kind: "steps",
            steps: [{ id: "tap-more", kind: "tap", target: { label: "More" } }],
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

function boundTest(
  id: string,
  name: string,
  connectionId: string,
  intent: string,
): AppMapScenarioTest {
  return {
    ...scope,
    id,
    createdAt: at,
    updatedAt: at,
    name,
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "step-action",
        intent,
        kind: "instruction",
        binding: { status: "resolved", kind: "connections", connectionIds: [connectionId] },
      },
    ],
  };
}

test("older-chat dest-end compiles number-equals without an invented dest-screen", () => {
  const compiled = compileAppMapTest(
    map(),
    boundTest(
      "test-older-chat",
      "Older conversation then 2+2 signed-in",
      "older-chat",
      "Older conversation then 2+2 signed-in",
    ),
  );
  assert.ok(compiled.plan.destEndRecipeIds?.length);
  const steps = Object.values(compiled.plan.recipes).flatMap((recipe) => recipe.steps);
  assert.ok(
    steps.some(
      (step) =>
        step.kind === "assert-content" && step.match === "number-equals" && step.expected === "4",
    ),
  );
});

test("Start Thread in the title without a recorded node is unrecorded, not Ready", () => {
  const work = boundTest(
    "test-more-header",
    "Header More on existing chat (Start Thread still absent)",
    "more-header",
    "Ask 3*5 then header More signed-in",
  );
  assert.throws(
    () => compileAppMapTest(map(), work),
    (error: unknown) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unresolved-step" &&
      /Start Thread is absent from the recorded tree — unrecorded/u.test(error.message),
  );
  const headerMore = boundTest(
    "test-more-header",
    "Header More on existing chat",
    "more-header",
    "Header More on existing chat signed-in",
  );
  const compiled = compileAppMapTest(map(), headerMore);
  assert.equal(compiledTestClaimedAbsentControl(headerMore, compiled.graph), undefined);
});

test("recorded generation actions compile under their actual feature names", () => {
  for (const name of [
    "Imagine Speed image generation signed-in",
    "Chat Heavy",
    "Video generation 1080p",
  ]) {
    const appMap = map();
    appMap.connections["more-header"]!.actions = [
      {
        id: "recorded-generation",
        kind: "steps",
        steps: [
          { kind: "tap", target: { label: "Imagine" } },
          { kind: "tap", target: { label: "Speed" } },
          { kind: "type", text: "A red cube" },
          { kind: "tap", target: { label: "Make image" } },
          { kind: "wait-for", target: { label: "Download" }, timeoutMs: 300_000 },
        ],
      },
    ];
    const work = boundTest("test-generation", name, "more-header", name);
    const compiled = compileAppMapTest(appMap, work);
    assert.equal(compiledTestClaimedAbsentControl(work, compiled.graph), undefined);
    assert.ok(
      Object.values(compiled.graph)
        .flatMap((recipe) => recipe.steps)
        .some((step) => step.kind === "wait-for" && step.target.label === "Download"),
    );
    assert.equal(work.name, name);
  }
});

test("generation titles do not bypass an actually unresolved recording binding", () => {
  const work = boundTest("test-generation", "Imagine Speed", "more-header", "Make image");
  work.steps[0]!.binding = { status: "unresolved", reason: "No recorded Make image action" };
  assert.throws(
    () => compileAppMapTest(map(), work),
    (error: unknown) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unresolved-step" &&
      error.stepId === "step-action" &&
      /No recorded Make image action/u.test(error.message),
  );
});

test("Inspect model choices still compiles when Heavy is only an expect-set label", () => {
  const inspect = boundTest(
    "test-model-iterate",
    "Inspect model choices",
    "more-header",
    "Open the model group, expect Fast/Auto/Expert/Heavy, Escape",
  );
  const compiled = compileAppMapTest(map(), inspect);
  assert.equal(compiledTestClaimedAbsentControl(inspect, compiled.graph), undefined);
});
