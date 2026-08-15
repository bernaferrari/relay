import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, Screen } from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import { AppMapTestCompileError } from "./app-map-test-compiler.js";

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

function fixture(): AppMap {
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
      "open-cart": {
        ...scope,
        id: "open-cart",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "cart" },
        label: "Open cart",
        state: "ready",
        actions: [{ id: "tap-cart", kind: "tap", target: { identifier: "cart" } }],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {
      login: {
        ...scope,
        id: "login",
        name: "Log in",
        parameters: [],
        actions: [{ id: "wait", kind: "wait", ms: 50 }],
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

function scenario(): AppMapScenarioTest {
  return {
    ...scope,
    id: "checkout-smoke",
    name: "Checkout smoke",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "navigate",
        kind: "instruction",
        intent: "Open the cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["open-cart"] },
      },
      {
        id: "validate",
        kind: "validation",
        intent: "The cart is visible",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: { kind: "expect", target: { identifier: "cart-title" }, condition: "visible" },
        },
      },
      {
        id: "extract",
        kind: "extraction",
        intent: "Remember the total",
        binding: {
          status: "resolved",
          kind: "extract",
          as: "cart_total",
          target: { identifier: "total" },
        },
      },
      {
        id: "manual",
        kind: "manual",
        intent: "Approve the payment prompt",
        binding: { status: "resolved", kind: "pause", message: "Approve payment" },
      },
      {
        id: "module",
        kind: "module",
        intent: "Log in",
        binding: { status: "resolved", kind: "routine", routineId: "login" },
      },
      {
        id: "decision",
        kind: "decision",
        intent: "Handle an empty cart",
        binding: { status: "resolved", kind: "condition", input: "cart_total", operator: "exists" },
        thenSteps: [
          {
            id: "decision-script",
            kind: "script",
            intent: "Normalize the value",
            binding: { status: "resolved", kind: "script", source: "return input" },
          },
        ],
      },
      {
        id: "loop",
        kind: "loop",
        intent: "Check twice",
        binding: { status: "resolved", kind: "repeat", count: 2 },
        steps: [
          {
            id: "loop-validation",
            kind: "validation",
            intent: "The total remains visible",
            binding: {
              status: "resolved",
              kind: "recipe-step",
              step: { kind: "expect", target: { identifier: "total" }, condition: "visible" },
            },
          },
        ],
      },
      {
        id: "script",
        kind: "script",
        intent: "Normalize the result",
        binding: { status: "resolved", kind: "script", source: "return input" },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

test("scenario tests compile all eight intent kinds deterministically with provenance", () => {
  const current = fixture();
  const work = scenario();
  const first = compileAppMapTest(current, work);
  const second = compileAppMapTest(current, structuredClone(work));

  assert.deepEqual(second, first);
  assert.equal(first.root.id, "app-map:checkout:test:checkout-smoke:root:r7");
  assert.deepEqual(
    first.root.steps.map(({ kind }) => kind),
    ["module", "expect", "extract", "pause", "module", "branch", "repeat", "script"],
  );
  assert.equal(first.plan.appMapRevision, 7);
  assert.deepEqual(
    new Set(first.plan.stepProvenance.map(({ testStepId }) => testStepId)),
    new Set([
      "navigate",
      "validate",
      "extract",
      "manual",
      "module",
      "decision",
      "decision-script",
      "loop",
      "loop-validation",
      "script",
    ]),
  );
  assert.ok(
    first.plan.stepProvenance
      .filter(({ testStepId }) => testStepId === "navigate")
      .every(({ referencedEntityIds }) => referencedEntityIds.includes("open-cart")),
  );
});

test("scenario capture policy compiles explicit screen evidence", () => {
  const screenshotCaptions = (work: AppMapScenarioTest) => {
    const compiled = compileAppMapTest(fixture(), work);
    return Object.values(compiled.graph)
      .flatMap((recipe) => recipe.steps)
      .flatMap((step) => (step.kind === "screenshot" ? [step.caption] : []));
  };
  const every = scenario();
  every.steps = [every.steps[0]!];
  every.capture = { mode: "every-screen" };
  assert.deepEqual(screenshotCaptions(every), ["screen:home", "screen:cart"]);

  const checkpoint = structuredClone(every);
  checkpoint.capture = { mode: "checkpoints", screenIds: ["cart"] };
  assert.deepEqual(screenshotCaptions(checkpoint), ["screen:cart"]);

  const final = structuredClone(every);
  final.capture = { mode: "final-screen" };
  assert.deepEqual(screenshotCaptions(final), ["final:Checkout smoke"]);
});

test("scenario steps capture one result frame without recapturing their bound path", () => {
  const work = scenario();
  work.steps = [{ ...work.steps[0]!, capture: true }];

  const compiled = compileAppMapTest(fixture(), work);
  assert.deepEqual(
    compiled.root.steps.map((step) =>
      step.kind === "screenshot" ? `${step.kind}:${step.caption}` : step.kind,
    ),
    ["module", "screenshot:step:navigate:Open the cart"],
  );
  assert.deepEqual(
    Object.values(compiled.graph)
      .filter((recipe) => recipe.id !== compiled.root.id)
      .flatMap((recipe) => recipe.steps)
      .filter((step) => step.kind === "screenshot"),
    [],
  );
  assert.equal(
    compiled.plan.stepProvenance.find(
      ({ recipeId, testStepId, stepIndex }) =>
        recipeId === compiled.root.id && testStepId === "navigate" && stepIndex === 1,
    )?.bindingKind,
    "connections",
  );
});

test("scenario instruction paths reuse their nearest shared checkpoint", () => {
  const map = fixture();
  map.screens.first = {
    ...screen("first"),
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.screens.second = {
    ...screen("second"),
    identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
  };
  map.connections["open-first"] = {
    ...map.connections["open-cart"]!,
    id: "open-first",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "first" },
    actions: [{ id: "tap-first", kind: "tap", target: { label: "First" } }],
  };
  map.connections["open-second"] = {
    ...map.connections["open-cart"]!,
    id: "open-second",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "second" },
    actions: [{ id: "tap-second", kind: "tap", target: { label: "Second" } }],
  };
  const work: AppMapScenarioTest = {
    ...scope,
    id: "coverage",
    name: "Coverage",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "first",
        kind: "instruction",
        intent: "Open first",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-cart", "open-first"],
        },
      },
      {
        id: "second",
        kind: "instruction",
        intent: "Open second",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-cart", "open-second"],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };

  const compiled = compileAppMapTest(map, work);
  const secondPath = Object.values(compiled.graph).find(
    (recipe) => recipe.title === "Checkout · Open second",
  )!;
  assert.equal(secondPath.steps[0]?.kind, "expect-screen");
  assert.equal(
    secondPath.steps[0]?.kind === "expect-screen" ? secondPath.steps[0].screenId : undefined,
    "cart",
  );
  assert.deepEqual(
    secondPath.steps[0]?.kind === "expect-screen" ? secondPath.steps[0].recovery : undefined,
    { strategy: "back", maxAttempts: 8, restoreParentViewport: true },
  );
  assert.equal(
    secondPath.steps.some((step) => step.kind === "tap" && step.target.label === "Second"),
    true,
  );
});

test("unresolved intent fails closed with a stable step-specific diagnostic", () => {
  const work = scenario();
  work.steps[0] = {
    id: "navigate",
    kind: "instruction",
    intent: "Open the cart",
    binding: {
      status: "unresolved",
      reason: "Record or choose the connection that opens the cart",
      candidates: [{ kind: "connection", id: "open-cart", label: "Open cart" }],
    },
  };
  assert.throws(
    () => compileAppMapTest(fixture(), work),
    (error) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unresolved-step" &&
      error.stepId === "navigate" &&
      /Record or choose/.test(error.message),
  );
});

test("screen assertions compile from approved graph identity", () => {
  const work = scenario();
  work.steps = [
    {
      id: "screen-check",
      kind: "validation",
      intent: "The cart screen is open",
      binding: {
        status: "resolved",
        kind: "assertion",
        assertion: { kind: "screen", screenId: "cart" },
      },
    },
  ];

  const compiled = compileAppMapTest(fixture(), work);
  assert.deepEqual(compiled.root.steps[0], {
    id: "relay-test-screen-check-1",
    kind: "expect-screen",
    screenId: "cart",
    screenTitle: "cart",
    fingerprint: "b".repeat(64),
    timeoutMs: 5_000,
  });
  assert.deepEqual(compiled.plan.stepProvenance[0]?.referencedEntityIds, ["cart"]);
});

test("scenario validation rejects unknown fields and duplicate nested identities", () => {
  const unknown = scenario() as AppMapScenarioTest & { surprise?: boolean };
  unknown.surprise = true;
  assert.throws(() => compileAppMapTest(fixture(), unknown), /unknown field surprise/);

  const duplicate = scenario();
  const decision = duplicate.steps.find((step) => step.kind === "decision");
  assert.ok(decision?.kind === "decision");
  decision.thenSteps[0]!.id = "navigate";
  assert.throws(() => compileAppMapTest(fixture(), duplicate), /duplicate step navigate/);

  const invalidCapture = scenario();
  invalidCapture.steps[0]!.capture = "yes" as unknown as boolean;
  assert.throws(() => compileAppMapTest(fixture(), invalidCapture), /capture must be a boolean/);
});

test("scenario compilation rejects cross-map scope and invalid binding payloads", () => {
  const wrongScope = scenario();
  wrongScope.appMapId = "another-map";
  assert.throws(
    () => compileAppMapTest(fixture(), wrongScope),
    (error) => error instanceof AppMapTestCompileError && error.code === "missing-reference",
  );

  const invalid = scenario();
  const module = invalid.steps.find((step) => step.kind === "module");
  assert.ok(module?.kind === "module" && module.binding.status === "resolved");
  module.binding.bindings = { account: 42 as unknown as string };
  assert.throws(() => compileAppMapTest(fixture(), invalid), /bindings.account must be a string/);
});
