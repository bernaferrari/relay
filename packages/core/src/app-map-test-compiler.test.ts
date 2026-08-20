import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, Screen } from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import { compileAppMapConnection } from "./app-map-compiler.js";
import {
  AppMapTestCompileError,
  appMapTestReturnRepairEndpoints,
} from "./app-map-test-compiler.js";

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

test("same-screen return checkpoints are benign preflight markers", () => {
  assert.equal(
    appMapTestReturnRepairEndpoints({
      kind: "expect-screen",
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "a".repeat(64),
      returnRequirement: {
        connectionId: "settings-to-settings",
        fromScreenId: "settings",
        destinationScreenId: "settings",
      },
    }),
    undefined,
  );
  assert.deepEqual(
    appMapTestReturnRepairEndpoints({
      kind: "expect-screen",
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "a".repeat(64),
      returnRequirement: {
        connectionId: "disable-kids-mode",
        fromScreenId: "kids-enabled",
        destinationScreenId: "kids-off",
      },
    }),
    { sourceScreenId: "kids-off", destinationScreenId: "settings" },
  );
});

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
      baselineTrust: "trusted",
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
  const provisionalMap = structuredClone(current);
  const provisionalBaseline = provisionalMap.screenVariants["cart-en"]!.scrollSurfaces![0]!;
  provisionalBaseline.status = "stopped";
  provisionalBaseline.reason = "seam-ambiguous";
  provisionalBaseline.restoredStartViewport = false;
  delete provisionalBaseline.composite;
  const provisionalCapture = Object.values(compileAppMapTest(provisionalMap, work).graph)
    .flatMap((recipe) => recipe.steps)
    .find((step) => step.kind === "capture-surface");
  assert.deepEqual(provisionalCapture, {
    kind: "capture-surface",
    screenId: "cart",
    screenTitle: "cart",
    variantId: "cart-en",
    surfaceId: "cart-surface",
    baselineCaptureId: "cart-baseline",
    reason: "Stable settings content should be captured completely.",
    maxScrolls: 2,
    baselineTrust: "recapture-required",
    baselineTrustReason:
      "Baseline capture is stopped/seam-ambiguous and its starting viewport was not restored.",
    baseline: { semanticNodeCount: 12 },
  });
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
  assert.deepEqual(moduleStep?.check, {
    id: instruction.id,
    title: instruction.intent,
    transitionDependencies: [
      {
        connectionId: "open-cart",
        originScreenId: "home",
        destination: { kind: "screen", screenId: "cart" },
      },
    ],
  });
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
        onCancel: "run-if-controllable",
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
    onCancel: "run-if-controllable",
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

test("nested cleanup cannot hide a cold app close in coverage", () => {
  const map = fixture();
  map.routines["kill-app"] = {
    ...scope,
    id: "kill-app",
    name: "Kill app",
    parameters: [],
    actions: [{ id: "close", kind: "app", action: "close", app: "ai.x.grok" }],
    createdAt: at,
    updatedAt: at,
  };
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
        routineId: "kill-app",
        terminalScreenId: "cart",
        onCancel: "skip",
      },
    },
  ];
  assert.throws(
    () => compileAppMapTest(map, work),
    (error: unknown) =>
      error instanceof AppMapTestCompileError && error.code === "cold-coverage-effect",
  );
});

test("later instruction checks split warm confirmation from proposed cold recovery", () => {
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
  assert.equal(recovery.steps[0]?.kind, "expect-screen");
  assert.equal(
    recovery.steps.some((step) => step.kind === "app" && step.action === "open"),
    false,
  );
  assert.equal(
    recovery.steps.some((step) => step.kind === "expect-screen" && step.screenId === "home"),
    true,
  );
  assert.equal(secondCheck.check.recovery.groupId, "transition:open-cart");
  assert.equal(secondCheck.check.recovery.transitionId, "open-cart");
  assert.equal(secondCheck.check.recovery.mode, "warm-transition");
  const proposedColdRecovery = compiled.graph[secondCheck.check.recovery.coldRecipeId!];
  assert.ok(proposedColdRecovery);
  assert.equal(proposedColdRecovery.steps[0]?.kind, "module");
  assert.deepEqual(secondCheck.check.transitionDependencies, [
    {
      connectionId: "open-cart",
      originScreenId: "home",
      destination: { kind: "screen", screenId: "cart" },
    },
  ]);
});

test("leaf instruction recovery confirms the last connection, not the shared parent", () => {
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
    label: "Open first",
    actions: [{ id: "tap-first", kind: "tap", target: { label: "First" } }],
  };
  const work = scenario();
  const setup = work.steps.find((step) => step.id === "module")!;
  const leaf = structuredClone(work.steps[0]!);
  assert.equal(leaf.kind, "instruction");
  if (leaf.kind !== "instruction") throw new Error("Expected an instruction");
  leaf.id = "open-first-row";
  leaf.intent = "Open first";
  leaf.binding = {
    status: "resolved",
    kind: "connections",
    connectionIds: ["open-cart", "open-first"],
  };
  work.steps = [setup, leaf];

  const compiled = compileAppMapTest(map, work);
  const leafCheck = compiled.root.steps.find(
    (step) => step.kind === "module" && step.check?.id === leaf.id,
  );
  assert.equal(leafCheck?.kind, "module");
  assert.ok(leafCheck.check?.recovery);
  assert.equal(leafCheck.check.recovery.groupId, "transition:open-first");
  assert.equal(leafCheck.check.recovery.transitionId, "open-first");
  const recovery = compiled.graph[leafCheck.check.recovery.recipeId];
  assert.ok(recovery);
  assert.equal(
    recovery.steps.some((step) => step.kind === "expect-screen" && step.screenId === "home"),
    false,
  );
  assert.equal(
    recovery.steps.some((step) => step.kind === "tap" && step.target.label === "First"),
    true,
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
  assert.deepEqual(screenshotCaptions(every), ["screen:cart"]);

  const checkpoint = structuredClone(every);
  checkpoint.capture = { mode: "checkpoints", screenIds: ["cart"] };
  assert.deepEqual(screenshotCaptions(checkpoint), ["screen:cart"]);

  const final = structuredClone(every);
  final.capture = { mode: "final-screen" };
  assert.deepEqual(screenshotCaptions(final), ["final:Checkout smoke"]);
});

test("every-screen captures only intentional terminal states and reports exact happy-path cost", () => {
  const map = fixture();
  map.screens.detail = {
    ...screen("detail"),
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.connections.detail = {
    ...map.connections["open-cart"]!,
    id: "detail",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "detail" },
    actions: [{ id: "tap-detail", kind: "tap", target: { label: "Detail" } }],
  };
  const work = scenario();
  work.steps = [
    {
      id: "navigate",
      kind: "instruction",
      intent: "Open detail",
      binding: {
        status: "resolved",
        kind: "connections",
        connectionIds: ["open-cart", "detail"],
      },
    },
  ];
  work.capture = { mode: "every-screen" };

  const compiled = compileAppMapTest(map, work);
  const screenshots = Object.values(compiled.graph).flatMap((recipe) =>
    recipe.steps.flatMap((step) => (step.kind === "screenshot" ? [step.caption] : [])),
  );
  assert.deepEqual(screenshots, ["screen:detail"]);
  assert.equal(compiled.plan.performance.screenshotCount, 1);
  assert.equal(compiled.plan.performance.destinationProofCount, 3);
  assert.equal(compiled.plan.performance.executableOperations, 6);
  assert.deepEqual(compiled.plan.startup, { mode: "cold" });
});

test("verified checkpoint startup skips cold setup but begins with fresh destination proof", () => {
  const map = fixture();
  map.screens.detail = {
    ...screen("detail"),
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.connections.detail = {
    ...map.connections["open-cart"]!,
    id: "detail",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "detail" },
    actions: [{ id: "tap-detail", kind: "tap", target: { label: "Detail" } }],
  };
  const work = scenario();
  work.steps = [
    work.steps.find((step) => step.id === "module")!,
    {
      id: "navigate",
      kind: "instruction",
      intent: "Open the cart",
      binding: { status: "resolved", kind: "connections", connectionIds: ["open-cart"] },
    },
    {
      id: "detail",
      kind: "instruction",
      intent: "Open detail",
      binding: { status: "resolved", kind: "connections", connectionIds: ["open-cart", "detail"] },
    },
  ];

  const compiled = compileAppMapTest(map, work, { entryCheckpointScreenId: "cart" });
  const firstCheck = compiled.root.steps[0];
  assert.equal(firstCheck?.kind, "module");
  const firstRecipe =
    firstCheck?.kind === "module" ? compiled.graph[firstCheck.recipeId] : undefined;
  assert.equal(firstRecipe?.steps[0]?.kind, "expect-screen");
  assert.equal(
    firstRecipe?.steps[0]?.kind === "expect-screen" ? firstRecipe.steps[0].screenId : undefined,
    "cart",
  );
  assert.equal(firstRecipe?.steps[0]?.id?.endsWith(":live-entry"), true);
  assert.equal(
    Object.values(compiled.graph).some((recipe) =>
      recipe.steps.some((step) => step.kind === "sleep" && step.ms === 50),
    ),
    false,
  );
  assert.deepEqual(compiled.plan.startup, { mode: "verified-checkpoint", screenId: "cart" });

  const standalone = compileAppMapConnection(map, "open-cart");
  assert.equal(standalone.recipes[standalone.rootRecipeId]?.steps[0]?.kind, "expect-screen");
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
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "cart",
        identity: structuredClone(map.screens.cart!.identity!),
        evidenceIds: ["cart-after-first-back"],
      },
    },
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
    secondPath.steps.slice(0, 3).map((step) => step.kind),
    ["key", "expect-screen", "tap"],
  );
  assert.deepEqual(secondPath.steps[0], {
    kind: "key",
    key: "back",
    id: "relay-return-open-first",
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
    secondPath.steps[1]?.kind === "expect-screen" ? secondPath.steps[1].id : undefined,
    "relay-return-proof-open-first",
  );
  assert.equal(
    secondPath.steps.some((step) => step.kind === "tap" && step.target.label === "Second"),
    true,
  );
});

test("scenario siblings never invent system Back without a taught return", () => {
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

  assert.throws(
    () => compileAppMapTest(map, work),
    (error: unknown) => {
      assert.ok(error instanceof AppMapTestCompileError);
      assert.equal(error.code, "unresolved-navigation");
      assert.equal(error.stepId, "second");
      assert.deepEqual(error.diagnostics, [
        {
          code: "unresolved-return",
          severity: "blocker",
          testId: "coverage",
          testStepId: "second",
          check: "Open second",
          recipeId: `app-map:${map.id}:flow:relay-test-coverage-second:r${map.revision}`,
          recipeStepId: "relay-return-required-open-first",
          connectionId: "open-first",
          sourceScreenId: "first",
          destinationScreenId: "cart",
          suggestion:
            "Teach or author a reviewed return from first to cart, then compile the Test again.",
          suggestedAction: {
            kind: "teach-return",
            appMapId: "checkout",
            fromScreenId: "first",
            destinationScreenId: "cart",
            blockedConnectionId: "open-first",
          },
        },
      ]);
      return true;
    },
  );
});

test("Add to home returns through one source-proven inverse before opening Advanced", () => {
  const map = fixture();
  map.screens.home!.title = "Settings";
  map.screens.cart!.title = "Widget";
  map.screens["add-home"] = {
    ...screen("add-home"),
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.screens.privacy = {
    ...screen("privacy"),
    title: "Advanced",
    identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
  };
  map.connections["open-cart"]!.return = {
    kind: "back",
    expectedDestination: {
      screenId: "home",
      identity: structuredClone(map.screens.home!.identity!),
      evidenceIds: ["settings-after-widget-back"],
    },
  };
  map.connections["add-home"] = {
    ...map.connections["open-cart"]!,
    id: "add-home",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "add-home" },
    actions: [{ id: "tap-add-home", kind: "tap", target: { label: "Add to Home screen" } }],
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "cart",
        identity: structuredClone(map.screens.cart!.identity!),
        evidenceIds: ["add-home-back-tree"],
      },
    },
  };
  map.connections.privacy = {
    ...map.connections["open-cart"]!,
    id: "privacy",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "privacy" },
    actions: [{ id: "tap-privacy", kind: "tap", target: { label: "Advanced" } }],
    return: undefined,
  };
  map.connections["return-from-add-home"] = {
    ...map.connections["open-cart"]!,
    id: "return-from-add-home",
    fromScreenId: "add-home",
    // Android Back intentionally skips the logical Widget preview and lands
    // directly on Settings. This one proof subsumes both forward edges.
    destination: { kind: "screen", screenId: "home" },
    actions: [
      {
        id: "back-from-add-home",
        kind: "steps",
        steps: [{ id: "press-back-from-add-home", kind: "key", key: "back" }],
      },
    ],
    return: undefined,
  };
  const work: AppMapScenarioTest = {
    ...scope,
    id: "reviewed-returns",
    name: "Reviewed returns",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "add-home",
        kind: "instruction",
        intent: "Open Add to Home screen",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-cart", "add-home"],
        },
      },
      {
        id: "privacy",
        kind: "instruction",
        intent: "Open Advanced",
        binding: { status: "resolved", kind: "connections", connectionIds: ["privacy"] },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };

  const compiled = compileAppMapTest(map, work);
  const sibling = Object.values(compiled.graph).find(
    (recipe) => recipe.title === "Checkout · Open Advanced",
  )!;
  const advancedCheck = compiled.root.steps.find(
    (step) => step.check?.title === "Open Advanced",
  )?.check;
  assert.equal(advancedCheck?.warmSourceScreenId, "add-home");
  assert.deepEqual(sibling.steps[0], {
    kind: "module",
    id: "relay-return-edge-return-from-add-home",
    recipeId: `app-map:${map.id}:connection:return-from-add-home:r${map.revision}`,
  });
  assert.deepEqual(
    compiled.graph[`app-map:${map.id}:connection:return-from-add-home:r${map.revision}`]?.steps
      .slice(0, 3)
      .map((step) => [step.kind, step.id]),
    [
      ["key", "press-back-from-add-home"],
      ["expect-screen", "relay-destination-return-from-add-home"],
    ],
  );
  assert.equal(
    sibling.steps.some(
      (step) => step.kind === "expect-screen" && step.id === "relay-return-proof-add-home",
    ),
    false,
  );
  assert.equal(
    sibling.steps.some(
      (step) =>
        step.id === "relay-return-open-cart" || step.id === "relay-return-required-open-cart",
    ),
    false,
  );
  assert.equal(
    sibling.steps.some((step) => step.kind === "tap" && step.target.label === "Advanced"),
    true,
  );

  map.connections["return-from-add-home"]!.actions = [
    {
      id: "dismiss-add-home",
      kind: "tap",
      target: { label: "OK" },
    },
  ];
  const semanticDismiss = compileAppMapTest(map, work);
  assert.deepEqual(
    semanticDismiss.graph[
      `app-map:${map.id}:connection:return-from-add-home:r${map.revision}`
    ]?.steps
      .slice(0, 3)
      .map((step) => [step.kind, step.id]),
    [
      ["tap", "relay-action-dismiss-add-home"],
      ["expect-screen", "relay-destination-return-from-add-home"],
    ],
  );

  delete map.connections["return-from-add-home"];
  const embedded = compileAppMapTest(map, work);
  const embeddedSibling = Object.values(embedded.graph).find(
    (recipe) => recipe.title === "Checkout · Open Advanced",
  )!;
  assert.deepEqual(
    embeddedSibling.steps.slice(0, 6).map((step) => [step.kind, step.id]),
    [
      ["key", "relay-return-add-home"],
      ["expect-screen", "relay-return-proof-add-home"],
      ["key", "relay-return-open-cart"],
      ["expect-screen", "relay-return-proof-open-cart"],
      ["tap", "relay-action-tap-privacy"],
      ["expect-screen", "relay-destination-privacy"],
    ],
  );
  assert.equal(
    embeddedSibling.steps[1]?.kind === "expect-screen"
      ? embeddedSibling.steps[1].screenId
      : undefined,
    "cart",
  );
  assert.equal(
    embeddedSibling.steps[3]?.kind === "expect-screen"
      ? embeddedSibling.steps[3].screenId
      : undefined,
    "home",
  );
  assert.equal(
    embeddedSibling.steps.some(
      (step) => step.kind === "expect-screen" && step.recovery?.strategy === "back",
    ),
    false,
  );
  assert.equal(
    embeddedSibling.steps.some((step) => step.kind === "tap" && step.target.label === "Advanced"),
    true,
  );

  delete map.connections["open-cart"]!.return;
  assert.throws(
    () => compileAppMapTest(map, work),
    (error: unknown) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unresolved-navigation" &&
      error.diagnostics.some(
        (diagnostic) =>
          diagnostic.connectionId === "open-cart" &&
          diagnostic.sourceScreenId === "cart" &&
          diagnostic.destinationScreenId === "home" &&
          diagnostic.testStepId === "privacy",
      ),
  );
});

test("a repeated terminal state uses its reviewed direct edge to the next sibling origin", () => {
  const map = fixture();
  map.screens.home!.title = "Settings";
  map.screens["kids-off"] = {
    ...screen("kids-off"),
    title: "Kids mode · Off",
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.screens["kids-enabled"] = {
    ...screen("kids-enabled"),
    title: "Kids mode · Enabled",
    identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
  };
  map.screens["kids-pin"] = {
    ...screen("kids-pin"),
    title: "Kids mode · PIN",
    identity: { schemaVersion: 1, fingerprint: "e".repeat(64) },
  };
  map.screens.nsfw = {
    ...screen("nsfw"),
    title: "NSFW content",
    identity: { schemaVersion: 1, fingerprint: "f".repeat(64) },
  };
  const connection = (
    id: string,
    fromScreenId: string,
    destinationScreenId: string,
    label: string,
  ) => ({
    ...map.connections["open-cart"]!,
    id,
    fromScreenId,
    destination: { kind: "screen" as const, screenId: destinationScreenId },
    label,
    actions: [{ id: `tap-${id}`, kind: "tap" as const, target: { label } }],
  });
  map.connections["open-kids-mode"] = connection("open-kids-mode", "home", "kids-off", "Kids mode");
  map.connections["enable-kids-mode"] = connection(
    "enable-kids-mode",
    "kids-off",
    "kids-enabled",
    "Enable",
  );
  map.connections["open-kids-pin"] = connection(
    "open-kids-pin",
    "kids-enabled",
    "kids-pin",
    "Lock",
  );
  map.connections["cancel-kids-pin"] = connection(
    "cancel-kids-pin",
    "kids-pin",
    "kids-enabled",
    "Cancel",
  );
  map.connections["disable-kids-mode"] = connection(
    "disable-kids-mode",
    "kids-enabled",
    "kids-off",
    "Disable",
  );
  map.connections["return-from-kids-mode"] = connection(
    "return-from-kids-mode",
    "kids-off",
    "home",
    "Back",
  );
  map.connections["open-nsfw"] = connection("open-nsfw", "home", "nsfw", "NSFW content");

  const work: AppMapScenarioTest = {
    ...scope,
    id: "kids-state-machine",
    name: "Kids state machine",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "exercise-kids",
        kind: "instruction",
        intent: "Enable, lock, cancel, then disable Kids mode",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: [
            "open-kids-mode",
            "enable-kids-mode",
            "open-kids-pin",
            "cancel-kids-pin",
            "disable-kids-mode",
          ],
        },
      },
      {
        id: "open-nsfw",
        kind: "instruction",
        intent: "Open NSFW content",
        binding: { status: "resolved", kind: "connections", connectionIds: ["open-nsfw"] },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };

  const compiled = compileAppMapTest(map, work);
  const sibling = Object.values(compiled.graph).find(
    (recipe) => recipe.title === "Checkout · Open NSFW content",
  )!;
  assert.deepEqual(sibling.steps[0], {
    kind: "module",
    id: "relay-return-edge-return-from-kids-mode",
    recipeId: `app-map:${map.id}:connection:return-from-kids-mode:r${map.revision}`,
  });
  assert.equal(
    sibling.steps.some(
      (step) => step.kind === "expect-screen" && step.id?.startsWith("relay-return-required-"),
    ),
    false,
  );
});

test("scenario siblings consume a named return connection that is not a pure Back key", () => {
  const map = fixture();
  map.screens["add-home"] = {
    ...screen("add-home"),
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.screens.privacy = {
    ...screen("privacy"),
    identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
  };
  map.connections["add-home"] = {
    ...map.connections["open-cart"]!,
    id: "add-home",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "add-home" },
    actions: [{ id: "tap-add-home", kind: "tap", target: { label: "Add to Home screen" } }],
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "cart",
        identity: structuredClone(map.screens.cart!.identity!),
        evidenceIds: ["add-home-back-tree"],
      },
    },
  };
  map.connections.privacy = {
    ...map.connections["open-cart"]!,
    id: "privacy",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "privacy" },
    actions: [{ id: "tap-privacy", kind: "tap", target: { label: "Privacy" } }],
    return: undefined,
  };
  map.connections["return-from-add-home"] = {
    ...map.connections["open-cart"]!,
    id: "return-from-add-home",
    fromScreenId: "add-home",
    destination: { kind: "screen", screenId: "home" },
    actions: [{ id: "tap-cancel", kind: "tap", target: { label: "Cancel" } }],
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "add-home",
        identity: structuredClone(map.screens["add-home"]!.identity!),
        evidenceIds: ["add-home-cancel-tree"],
      },
    },
  };
  const work: AppMapScenarioTest = {
    ...scope,
    id: "named-return-tap",
    name: "Named return tap",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "add-home",
        kind: "instruction",
        intent: "Open Add to Home screen",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-cart", "add-home"],
        },
      },
      {
        id: "privacy",
        kind: "instruction",
        intent: "Open Privacy",
        binding: { status: "resolved", kind: "connections", connectionIds: ["privacy"] },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };

  const compiled = compileAppMapTest(map, work);
  const sibling = Object.values(compiled.graph).find(
    (recipe) => recipe.title === "Checkout · Open Privacy",
  )!;
  assert.deepEqual(sibling.steps[0], {
    kind: "module",
    id: "relay-return-edge-return-from-add-home",
    recipeId: `app-map:${map.id}:connection:return-from-add-home:r${map.revision}`,
  });
  assert.equal(
    compiled.graph[
      `app-map:${map.id}:connection:return-from-add-home:r${map.revision}`
    ]?.steps.some((step) => step.kind === "tap" && step.target.label === "Cancel"),
    true,
  );
  assert.equal(
    sibling.steps.some((step) => step.kind === "key" && step.key === "back"),
    false,
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

test("scenario recovery blocks a horizontal swipe destination without a reviewed return", () => {
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

  assert.throws(
    () => compileAppMapTest(map, work),
    (error: unknown) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unresolved-navigation" &&
      error.diagnostics.some(
        (diagnostic) =>
          diagnostic.connectionId === "page-cart" &&
          diagnostic.sourceScreenId === "cart-page-two" &&
          diagnostic.destinationScreenId === "cart",
      ),
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
