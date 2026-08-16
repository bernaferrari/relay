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
      "restore-cart": {
        ...scope,
        id: "restore-cart",
        name: "Restore cart",
        parameters: [],
        actions: [
          {
            id: "assert-cart",
            kind: "assertion",
            assertion: { kind: "screen", screenId: "cart" },
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

test("compiled graph Tests retain a conservative logical-surface capture policy", () => {
  const current = fixture();
  current.screens.cart!.variantIds = ["cart-en"];
  current.screenVariants["cart-en"] = {
    ...scope,
    id: "cart-en",
    screenId: "cart",
    targetProfile: {
      id: "iphone-en",
      targetId: "iphone-1",
      source: "device",
      platform: "ios",
      name: "iPhone · English",
      capabilities: ["screenshot"],
      observedAt: at,
    },
    scrollCapturePolicy: {
      captureMode: "viewport",
      source: "recommended",
      reason: "Account-specific content stays viewport-only.",
      decidedAt: at,
    },
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  work.surfaceBindings = [
    {
      screenId: "cart",
      variantId: "cart-en",
      captureMode: "viewport",
      reason: "Account-specific content stays viewport-only.",
      compare: "visual-and-semantic",
      repair: "propose-recapture",
    },
  ];
  const compiled = compileAppMapTest(current, work);
  assert.deepEqual(compiled.plan.surfaceBindings, work.surfaceBindings);
});

test("full-surface bindings compile one executable capture after reaching the destination", () => {
  const current = fixture();
  const digest = "c".repeat(64);
  const evidence = (id: string, mime: "image/png" | "application/json") => ({
    id,
    uri: `relay-evidence://${digest}`,
    sha256: digest,
    mime,
    bytes: 10,
  });
  current.screens.cart!.variantIds = ["cart-en"];
  current.screenVariants["cart-en"] = {
    ...scope,
    id: "cart-en",
    screenId: "cart",
    targetProfile: {
      id: "iphone-en",
      targetId: "iphone-1",
      source: "device",
      platform: "ios",
      name: "iPhone · English",
      capabilities: ["screenshot", "snapshot", "scroll"],
      observedAt: at,
    },
    scrollCapturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: "Stable settings content should be captured completely.",
      decidedAt: at,
    },
    scrollSurfaces: [
      {
        schemaVersion: 1,
        id: "cart-surface",
        captureId: "cart-baseline",
        targetProfileId: "iphone-en",
        capturePolicy: {
          captureMode: "full-surface",
          source: "explicit",
          reason: "Stable settings content should be captured completely.",
          decidedAt: at,
        },
        capturedAt: at,
        status: "completed",
        reason: "end-of-content",
        message: "Reached the end of the cart.",
        restoredStartViewport: true,
        viewports: [
          {
            index: 0,
            offsetY: 0,
            appendedHeight: 0,
            capturedAt: at,
            width: 100,
            height: 200,
            screenshot: { ...evidence("shot", "image/png"), mime: "image/png" },
            accessibilityTree: {
              ...evidence("tree", "application/json"),
              mime: "application/json",
            },
          },
        ],
        composite: {
          ...evidence("composite", "image/png"),
          mime: "image/png",
          width: 100,
          height: 200,
        },
        mergedTree: {
          ...evidence("merged", "application/json"),
          mime: "application/json",
          nodeCount: 12,
        },
        manifest: {
          ...evidence("manifest", "application/json"),
          mime: "application/json",
        },
      },
    ],
    evidenceIds: ["shot", "tree", "composite", "merged", "manifest"],
    evidenceUris: [`relay-evidence://${digest}`],
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  work.steps = [work.steps[0]!];
  work.surfaceBindings = [
    {
      screenId: "cart",
      variantId: "cart-en",
      captureMode: "full-surface",
      reason: "Stable settings content should be captured completely.",
      surfaceId: "cart-surface",
      baselineCaptureId: "cart-baseline",
      compare: "visual-and-semantic",
      repair: "propose-recapture",
    },
  ];

  const compiled = compileAppMapTest(current, work);
  const captures = Object.values(compiled.graph)
    .flatMap((recipe) => recipe.steps)
    .filter((step) => step.kind === "capture-surface");
  assert.deepEqual(captures, [
    {
      kind: "capture-surface",
      screenId: "cart",
      screenTitle: "cart",
      variantId: "cart-en",
      surfaceId: "cart-surface",
      baselineCaptureId: "cart-baseline",
      reason: "Stable settings content should be captured completely.",
      maxScrolls: 2,
      baseline: { compositeWidth: 100, compositeHeight: 200, semanticNodeCount: 12 },
    },
  ]);
  const destinationRecipe = Object.values(compiled.graph).find((recipe) =>
    recipe.steps.some((step) => step.kind === "expect-screen" && step.screenId === "cart"),
  );
  assert.deepEqual(
    destinationRecipe?.steps.slice(-2).map((step) => step.kind),
    ["expect-screen", "capture-surface"],
  );

  const freshRun = compileAppMapTest(current, work, {
    forceRecaptureSurfaceScreenIds: ["cart"],
  });
  const freshCapture = Object.values(freshRun.graph)
    .flatMap((recipe) => recipe.steps)
    .find((step) => step.kind === "capture-surface");
  assert.equal(freshCapture?.kind === "capture-surface" && freshCapture.forceRecapture, true);
  assert.equal(
    Object.values(freshRun.plan.recipes)
      .flatMap((recipe) => recipe.steps)
      .some((step) => step.kind === "capture-surface" && step.forceRecapture),
    true,
  );
  assert.equal(
    Object.values(compiled.graph)
      .flatMap((recipe) => recipe.steps)
      .some((step) => step.kind === "capture-surface" && step.forceRecapture),
    false,
  );
  assert.throws(
    () =>
      compileAppMapTest(current, work, {
        forceRecaptureSurfaceScreenIds: ["missing-surface"],
      }),
    /no full-surface binding for missing-surface/u,
  );
});

test("a logical surface is captured once even when a later path returns to it", () => {
  const current = fixture();
  const digest = "d".repeat(64);
  const evidence = (id: string, mime: "image/png" | "application/json") => ({
    id,
    uri: `relay-evidence://${digest}`,
    sha256: digest,
    mime,
    bytes: 10,
  });
  current.screens.cart!.variantIds = ["cart-en"];
  current.screenVariants["cart-en"] = {
    ...scope,
    id: "cart-en",
    screenId: "cart",
    targetProfile: {
      id: "iphone-en",
      targetId: "iphone-1",
      source: "device",
      platform: "ios",
      name: "iPhone · English",
      capabilities: ["screenshot", "snapshot", "scroll"],
      observedAt: at,
    },
    scrollSurfaces: [
      {
        schemaVersion: 1,
        id: "cart-surface",
        captureId: "cart-baseline",
        targetProfileId: "iphone-en",
        capturePolicy: {
          captureMode: "full-surface",
          source: "explicit",
          reason: "Stable product content.",
          decidedAt: at,
        },
        capturedAt: at,
        status: "completed",
        reason: "end-of-content",
        message: "Reached the end.",
        restoredStartViewport: true,
        viewports: [
          {
            index: 0,
            offsetY: 0,
            appendedHeight: 0,
            capturedAt: at,
            width: 100,
            height: 200,
            screenshot: { ...evidence("shot", "image/png"), mime: "image/png" },
            accessibilityTree: {
              ...evidence("tree", "application/json"),
              mime: "application/json",
            },
          },
        ],
        composite: {
          ...evidence("composite", "image/png"),
          mime: "image/png",
          width: 100,
          height: 200,
        },
        mergedTree: {
          ...evidence("merged", "application/json"),
          mime: "application/json",
          nodeCount: 12,
        },
        manifest: { ...evidence("manifest", "application/json"), mime: "application/json" },
      },
    ],
    evidenceIds: ["shot", "tree", "composite", "merged", "manifest"],
    evidenceUris: [`relay-evidence://${digest}`],
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  work.steps = [structuredClone(work.steps[0]!), structuredClone(work.steps[0]!)];
  work.steps[1]!.id = "return-to-cart";
  work.steps[1]!.intent = "Return to cart";
  work.surfaceBindings = [
    {
      screenId: "cart",
      variantId: "cart-en",
      captureMode: "full-surface",
      reason: "Stable product content.",
      surfaceId: "cart-surface",
      baselineCaptureId: "cart-baseline",
      compare: "visual-and-semantic",
      repair: "propose-recapture",
    },
  ];

  const compiled = compileAppMapTest(current, work);
  assert.equal(
    Object.values(compiled.graph)
      .flatMap((recipe) => recipe.steps)
      .filter((step) => step.kind === "capture-surface").length,
    1,
  );
});

test("instruction branches compile as isolated campaign checks", () => {
  const map = fixture();
  const testDefinition = scenario();
  const compiled = compileAppMapTest(map, testDefinition);
  const instruction = testDefinition.steps.find((step) => step.kind === "instruction");
  assert.ok(instruction);
  const moduleStep = compiled.root.steps.find(
    (step) => step.kind === "module" && step.check?.id === instruction.id,
  );
  assert.deepEqual(moduleStep?.check, { id: instruction.id, title: instruction.intent });
});

test("instruction cleanup compiles an auditable always-run routine and terminal state", () => {
  const map = fixture();
  const work = scenario();
  const instruction = work.steps[0]!;
  assert.equal(instruction.kind, "instruction");
  if (instruction.kind !== "instruction") {
    throw new Error("Expected the first scenario step to be an instruction");
  }
  work.steps = [
    {
      ...instruction,
      cleanup: {
        kind: "routine",
        routineId: "restore-cart",
        terminalScreenId: "cart",
        onCancel: "skip",
      },
    },
  ];

  const compiled = compileAppMapTest(map, work);
  const checkStep = compiled.root.steps.find(
    (step) => step.kind === "module" && step.check?.id === "navigate",
  );
  assert.equal(checkStep?.kind, "module");
  assert.deepEqual(checkStep.check?.cleanup, {
    recipeId: "app-map:checkout:routine:restore-cart:r7",
    terminalScreenId: "cart",
    onCancel: "skip",
  });
  assert.ok(compiled.graph["app-map:checkout:routine:restore-cart:r7"]);
  assert.equal(
    compiled.plan.stepProvenance.some(
      (entry) =>
        entry.testStepId === "navigate" &&
        entry.referencedEntityIds.includes("restore-cart") &&
        entry.referencedEntityIds.includes("cart"),
    ),
    true,
  );
});

test("later instruction checks compile one canonical cold recovery path", () => {
  const map = fixture();
  const work = scenario();
  const setup = work.steps.find((step) => step.id === "module")!;
  const first = structuredClone(work.steps[0]!);
  const second = structuredClone(first);
  second.id = "navigate-again";
  second.intent = "Open the cart again";
  work.steps = [setup, first, second];

  const compiled = compileAppMapTest(map, work);
  const secondCheck = compiled.root.steps.find(
    (step) => step.kind === "module" && step.check?.id === second.id,
  );
  assert.equal(secondCheck?.kind, "module");
  assert.ok(secondCheck.check?.recovery);
  const recovery = compiled.graph[secondCheck.check.recovery.recipeId];
  assert.ok(recovery);
  assert.equal(recovery.steps[0]?.kind, "module");
  assert.equal(
    recovery.steps.some((step) => step.kind === "expect-screen" && step.screenId === "home"),
    true,
  );
  assert.equal(secondCheck.check.recovery.groupId, "checkout-smoke:root:check:navigate-again");
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
  assert.deepEqual(screenshotCaptions(every), ["screen:cart"]);

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
    actions: [
      { id: "reveal-first", kind: "reveal", target: { label: "First" }, direction: "auto" },
      { id: "tap-first", kind: "tap", target: { label: "First" } },
    ],
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
  assert.deepEqual(
    secondPath.steps.slice(0, 2).map((step) => step.kind),
    ["key", "expect-screen"],
  );
  assert.deepEqual(secondPath.steps[0], {
    kind: "key",
    key: "back",
    id: "relay-recover-back-1",
  });
  assert.equal(
    secondPath.steps[1]?.kind === "expect-screen" ? secondPath.steps[1].screenId : undefined,
    "cart",
  );
  assert.equal(
    secondPath.steps[1]?.kind === "expect-screen" ? secondPath.steps[1].recovery : undefined,
    undefined,
  );
  assert.equal(
    secondPath.steps.some((step) => step.kind === "tap" && step.target.label === "Second"),
    true,
  );
});

test("scenario instruction paths carry an exact contiguous destination checkpoint", () => {
  const map = fixture();
  map.screens.first = {
    ...screen("first"),
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.connections["open-first"] = {
    ...map.connections["open-cart"]!,
    id: "open-first",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "first" },
    actions: [{ id: "tap-first", kind: "tap", target: { label: "First" } }],
  };
  const work: AppMapScenarioTest = {
    ...scenario(),
    capture: { mode: "every-screen" },
    steps: [
      scenario().steps[0]!,
      {
        id: "first",
        kind: "instruction",
        intent: "Open first",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-first"],
        },
      },
    ],
  };

  const compiled = compileAppMapTest(map, work);
  const secondPath = Object.values(compiled.graph).find(
    (recipe) => recipe.title === "Checkout · Open first",
  )!;
  assert.equal(secondPath.steps[0]?.kind, "tap");
  assert.deepEqual(
    secondPath.steps.flatMap((step) => (step.kind === "screenshot" ? [step.caption] : [])),
    ["screen:first"],
  );
  assert.equal(
    secondPath.steps.some((step) => step.kind === "expect-screen" && step.screenId === "cart"),
    false,
  );
});

test("scenario recovery treats vertical swipe observations as one logical scroll surface", () => {
  const map = fixture();
  map.screens["cart-bottom"] = {
    ...screen("cart-bottom"),
    identity: { schemaVersion: 1, fingerprint: "e".repeat(64), aliases: ["f".repeat(64)] },
  };
  map.screens.second = {
    ...screen("second"),
    identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
  };
  map.connections["scroll-cart"] = {
    ...map.connections["open-cart"]!,
    id: "scroll-cart",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "cart-bottom" },
    actions: [
      {
        id: "swipe-cart",
        kind: "gesture",
        gesture: { kind: "swipe", from: { x: 500, y: 1_600 }, to: { x: 500, y: 600 } },
      },
    ],
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
    id: "scroll-coverage",
    name: "Scroll coverage",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "bottom",
        kind: "instruction",
        intent: "Reveal the bottom of the cart",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-cart", "scroll-cart"],
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
  const expectation = secondPath.steps[0];
  assert.equal(expectation?.kind, "expect-screen");
  assert.equal(expectation?.kind === "expect-screen" ? expectation.screenId : undefined, "cart");
  assert.deepEqual(
    expectation?.kind === "expect-screen" ? new Set(expectation.aliases) : undefined,
    new Set(["e".repeat(64), "f".repeat(64)]),
  );
});

test("scenario recovery does not merge horizontal swipe destinations", () => {
  const map = fixture();
  map.screens["cart-page-two"] = {
    ...screen("cart-page-two"),
    identity: { schemaVersion: 1, fingerprint: "e".repeat(64) },
  };
  map.screens.second = {
    ...screen("second"),
    identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
  };
  map.connections["page-cart"] = {
    ...map.connections["open-cart"]!,
    id: "page-cart",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "cart-page-two" },
    actions: [
      {
        id: "swipe-cart",
        kind: "gesture",
        gesture: { kind: "swipe", from: { x: 900, y: 800 }, to: { x: 200, y: 800 } },
      },
    ],
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
    id: "paged-coverage",
    name: "Paged coverage",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "page-two",
        kind: "instruction",
        intent: "Show page two",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-cart", "page-cart"],
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
  const expectation = secondPath.steps[0];
  assert.equal(expectation?.kind, "expect-screen");
  assert.equal(expectation?.kind === "expect-screen" ? expectation.aliases : undefined, undefined);
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
