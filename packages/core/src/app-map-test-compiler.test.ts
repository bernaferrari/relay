import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapScenarioTest,
  RecipeStep,
  Screen,
  TargetProfile,
} from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import { compileAppMapConnection } from "./app-map-compiler.js";
import {
  AppMapTestCompileError,
  appMapTestReturnRepairEndpoints,
  proposeAppMapTestExecutionSchedule,
} from "./app-map-test-compiler.js";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import { stayAppLocaleDestinationCheck } from "./stay-app-locale-destination.js";
import { validateRecipeSteps } from "./recipe-validation.js";

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

test("initial passive self-loop keeps destination proof and later source proof", () => {
  const current = fixture();
  current.connections.observe = {
    ...current.connections["open-cart"]!,
    id: "observe",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "home" },
    label: "Observe",
    actions: [{ id: "observe", kind: "passive", reason: "observe-only" }],
  };
  const base = scenario();
  const work = {
    ...base,
    capture: { mode: "every-screen" as const },
    steps: [
      {
        id: "observe",
        kind: "instruction" as const,
        intent: "Observe",
        capture: true,
        binding: {
          status: "resolved" as const,
          kind: "connections" as const,
          connectionIds: ["observe"],
        },
      },
      ...base.steps,
    ],
  };
  const compiled = compileAppMapTest(current, work);
  const root = compiled.graph[compiled.plan.rootRecipeId]!;
  const observeModule = root.steps[0];
  assert.equal(observeModule?.kind, "module");
  if (observeModule?.kind !== "module") throw new Error("observe module was not compiled");
  const observeRecipe = compiled.graph[observeModule.recipeId]!;
  assert.equal(
    observeRecipe.steps.some((step) => step.id?.startsWith("relay-source-")),
    false,
  );
  assert.equal(
    observeRecipe.steps.some((step) => step.id?.startsWith("relay-destination-")),
    true,
  );
  const firstTapModule = root.steps.find((step) => step.id?.includes("navigate"));
  assert.equal(firstTapModule?.kind, "module");
  if (firstTapModule?.kind !== "module") throw new Error("first tap module was not compiled");
  const firstTapRecipe = compiled.graph[firstTapModule!.recipeId]!;
  assert.equal(
    firstTapRecipe.steps.some((step) => step.id === "relay-action-tap-cart"),
    true,
  );
  assert.equal(
    firstTapRecipe.steps.some((step) => step.id?.startsWith("relay-destination-")),
    true,
  );
});

test("compiles a graph validation wait-response step with busy and idle guards", () => {
  const current = fixture();
  const work = scenario();
  work.steps.push({
    id: "wait-answer",
    kind: "validation",
    intent: "Wait for the generated answer to finish",
    binding: {
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "wait-response",
        target: { role: "article", text: "ChatGPT said" },
        busyTarget: { label: "Stop generating" },
        idleTarget: { label: "Send message" },
        timeoutMs: 5_000,
        stableForMs: 500,
      },
    },
  });
  const compiled = compileAppMapTest(current, work);
  const root = compiled.graph[compiled.plan.rootRecipeId]!;
  const wait = root.steps.find((step) => step.kind === "wait-response");
  assert.deepEqual(wait, {
    kind: "wait-response",
    target: { role: "article", text: "ChatGPT said" },
    busyTarget: { label: "Stop generating" },
    idleTarget: { label: "Send message" },
    timeoutMs: 5_000,
    stableForMs: 500,
    id: "relay-test-wait-answer-1",
  });
});

test("compiles visual and semantic assertion steps", () => {
  const current = fixture();
  const work = scenario();
  work.steps.push(
    {
      id: "visual-judge",
      kind: "validation",
      intent: "Composer chrome is intact",
      binding: {
        status: "resolved",
        kind: "assertion",
        assertion: {
          kind: "visual",
          criteria: ["Composer is visible"],
          region: { x: 80, y: 200, width: 900, height: 1400 },
        },
      },
    },
    {
      id: "semantic-judge",
      kind: "validation",
      intent: "Reply names a place",
      binding: {
        status: "resolved",
        kind: "assertion",
        assertion: {
          kind: "semantic",
          input: "reply",
          criteria: ["Reply must mention a location"],
        },
      },
    },
    {
      id: "ignore-reply",
      kind: "validation",
      intent: "Ignore the reply body for identity",
      binding: {
        status: "resolved",
        kind: "recipe-step",
        step: {
          kind: "identity-ignore",
          name: "reply body",
          region: { x: 80, y: 200, width: 900, height: 1400 },
        },
      },
    },
  );
  const compiled = compileAppMapTest(current, work);
  const root = compiled.graph[compiled.plan.rootRecipeId]!;
  assert.deepEqual(
    root.steps.find((step) => step.kind === "evaluate-visual"),
    {
      kind: "evaluate-visual",
      criteria: ["Composer is visible"],
      region: { x: 80, y: 200, width: 900, height: 1400 },
      id: "relay-test-visual-judge-1",
    },
  );
  assert.deepEqual(
    root.steps.find((step) => step.kind === "evaluate-semantic"),
    {
      kind: "evaluate-semantic",
      input: "reply",
      criteria: ["Reply must mention a location"],
      id: "relay-test-semantic-judge-1",
    },
  );
  assert.deepEqual(
    root.steps.find((step) => step.kind === "identity-ignore"),
    {
      kind: "identity-ignore",
      name: "reply body",
      region: { x: 80, y: 200, width: 900, height: 1400 },
      id: "relay-test-ignore-reply-1",
    },
  );
});

test("compiles visual judge consensus onto evaluate-visual", () => {
  const current = fixture();
  const work = scenario();
  work.steps.push({
    id: "visual-consensus",
    kind: "validation",
    intent: "Composer chrome is intact",
    binding: {
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "visual",
        criteria: ["Composer is visible"],
        requireAgreement: true,
      },
    },
  });
  const compiled = compileAppMapTest(current, work);
  const root = compiled.graph[compiled.plan.rootRecipeId]!;
  assert.deepEqual(
    root.steps.find((step) => step.kind === "evaluate-visual"),
    {
      kind: "evaluate-visual",
      criteria: ["Composer is visible"],
      requireAgreement: true,
      provider: "openrouter",
      secondProvider: "openrouter",
      secondModel: "google/gemini-2.5-flash",
      id: "relay-test-visual-consensus-1",
    },
  );
});

test("proposes monotonic document order only inside a proven Settings segment", () => {
  const current = fixture();
  current.screenVariants.settings = {
    ...scope,
    id: "settings",
    screenId: "home",
    targetProfile: {
      id: "android",
      targetId: "pixel",
      source: "device",
      platform: "android",
      name: "Pixel",
      capabilities: [],
      observedAt: at,
    },
    evidenceIds: [],
    scrollSurfaces: [
      {
        semanticIndex: {
          schemaVersion: 1,
          documentHeight: 1_200,
          viewportHeight: 500,
          anchors: [
            { order: 0, documentY: 200, target: { label: "Earlier" }, label: "Earlier" },
            { order: 1, documentY: 800, target: { label: "Later" }, label: "Later" },
          ],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  } as unknown as AppMap["screenVariants"][string];
  current.connections.later = {
    ...current.connections["open-cart"]!,
    id: "later",
    navigation: {
      targetAlternatives: [{ kind: "accessibility", label: "Later" }],
      expectedDestination: {
        screenId: "cart",
        identity: screen("cart").identity!,
        evidenceIds: [],
      },
    },
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "home",
        identity: screen("home").identity!,
        evidenceIds: [],
      },
    },
  };
  current.connections.earlier = {
    ...current.connections["open-cart"]!,
    id: "earlier",
    navigation: {
      targetAlternatives: [{ kind: "accessibility", label: "Earlier" }],
      expectedDestination: {
        screenId: "cart",
        identity: screen("cart").identity!,
        evidenceIds: [],
      },
    },
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "home",
        identity: screen("home").identity!,
        evidenceIds: [],
      },
    },
  };
  const graph = {
    root: {
      id: "root",
      title: "Root",
      source: "custom",
      createdAt: at,
      updatedAt: at,
      steps: [
        {
          kind: "module",
          recipeId: "later",
          check: {
            id: "later",
            title: "Later",
            warmSourceScreenId: "home",
            transitionDependencies: [
              {
                connectionId: "later",
                originScreenId: "home",
                destination: { kind: "screen", screenId: "cart" },
              },
            ],
          },
        },
        {
          kind: "module",
          recipeId: "earlier",
          check: {
            id: "earlier",
            title: "Earlier",
            warmSourceScreenId: "home",
            transitionDependencies: [
              {
                connectionId: "earlier",
                originScreenId: "home",
                destination: { kind: "screen", screenId: "cart" },
              },
            ],
          },
        },
        {
          kind: "module",
          recipeId: "cleanup",
          check: {
            id: "cleanup",
            title: "Cleanup boundary",
            warmSourceScreenId: "home",
            cleanup: { recipeId: "cleanup-routine", terminalScreenId: "home", onCancel: "skip" },
          },
        },
      ],
    },
  } as unknown as Record<string, import("./recipes.js").Recipe>;
  assert.deepEqual(proposeAppMapTestExecutionSchedule(current, "root", graph), {
    schemaVersion: 2,
    mode: "review-required",
    checks: [
      {
        checkId: "earlier",
        recipeId: "earlier",
        authoredIndex: 1,
        proposedIndex: 0,
        sourceScreenId: "home",
        semanticDocumentOrder: 0,
        documentY: 200,
        disposition: "scheduled",
        reason: "reviewed-return-equivalence",
        returnToSource: {
          sourceScreenId: "home",
          terminalScreenId: "cart",
          kind: "back",
          connectionIds: ["earlier"],
        },
      },
      {
        checkId: "later",
        recipeId: "later",
        authoredIndex: 0,
        proposedIndex: 1,
        sourceScreenId: "home",
        semanticDocumentOrder: 1,
        documentY: 800,
        disposition: "scheduled",
        reason: "reviewed-return-equivalence",
        returnToSource: {
          sourceScreenId: "home",
          terminalScreenId: "cart",
          kind: "back",
          connectionIds: ["later"],
        },
      },
      {
        checkId: "cleanup",
        recipeId: "cleanup",
        authoredIndex: 2,
        proposedIndex: 2,
        sourceScreenId: "home",
        disposition: "fixed",
        reason: "cleanup-boundary",
      },
    ],
    deferredBranches: [],
  });
});

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
  const rawTreeSha = "a".repeat(64);
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
    evidenceIds: ["cart-tree"],
    evidenceUris: [`relay-evidence://${rawTreeSha}`],
    rawAccessibilityTree: {
      id: "cart-tree",
      uri: `relay-evidence://${rawTreeSha}`,
      sha256: rawTreeSha,
      mime: "application/json",
      bytes: 42,
      observationId: "observe-cart-en",
      capturedAt: 10,
    },
    createdAt: at,
    updatedAt: at,
  };
  // Deliberately share one CAS blob: immutable bytes alone cannot decide that
  // English and Portuguese source variants are selector-equivalent.
  const rawTreeShaPt = rawTreeSha;
  current.screenVariants["cart-pt"] = {
    ...current.screenVariants["cart-en"]!,
    id: "cart-pt",
    targetProfile: {
      ...current.screenVariants["cart-en"]!.targetProfile,
      id: "iphone-pt",
      name: "iPhone · Portuguese",
    },
    evidenceIds: ["cart-tree-pt"],
    evidenceUris: [`relay-evidence://${rawTreeShaPt}`],
    rawAccessibilityTree: {
      id: "cart-tree-pt",
      uri: `relay-evidence://${rawTreeShaPt}`,
      sha256: rawTreeShaPt,
      mime: "application/json",
      bytes: 42,
      observationId: "observe-cart-pt",
      capturedAt: 11,
    },
  };
  // Deliberately store the variants in the opposite insertion order as their
  // stable IDs. The frozen plan must not inherit mutable object order.
  current.screenVariants = {
    "cart-pt": current.screenVariants["cart-pt"]!,
    "cart-en": current.screenVariants["cart-en"]!,
  };
  // Input order is deliberately reversed: a compiled test must retain every
  // immutable variant tree but produce one deterministic source ledger.
  current.screens.cart!.variantIds = ["cart-pt", "cart-en"];
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
  assert.deepEqual(compiled.plan.rawAccessibilitySourcesByScreenId, {
    cart: [
      {
        screenId: "cart",
        variant: {
          id: "cart-en",
          targetProfileId: "iphone-en",
          targetId: "iphone-1",
          platform: "ios",
          capabilities: ["screenshot"],
        },
        origin: {
          kind: "screen-variant",
          observationId: "observe-cart-en",
          capturedAt: 10,
        },
        tree: current.screenVariants["cart-en"]!.rawAccessibilityTree,
      },
      {
        screenId: "cart",
        variant: {
          id: "cart-pt",
          targetProfileId: "iphone-pt",
          targetId: "iphone-1",
          platform: "ios",
          capabilities: ["screenshot"],
        },
        origin: {
          kind: "screen-variant",
          observationId: "observe-cart-pt",
          capturedAt: 11,
        },
        tree: current.screenVariants["cart-pt"]!.rawAccessibilityTree,
      },
    ],
    home: [],
  });
  assert.deepEqual(compiled.plan.rawAccessibilityVariantsByScreenId, {
    cart: [
      {
        id: "cart-en",
        targetProfileId: "iphone-en",
        targetId: "iphone-1",
        platform: "ios",
        capabilities: ["screenshot"],
      },
      {
        id: "cart-pt",
        targetProfileId: "iphone-pt",
        targetId: "iphone-1",
        platform: "ios",
        capabilities: ["screenshot"],
      },
    ],
    home: [],
  });
  assert.deepEqual(compiled.plan.rawAccessibilityTargetProfiles, [
    {
      id: "iphone-en",
      targetId: "iphone-1",
      platform: "ios",
      capabilities: ["screenshot"],
    },
    {
      id: "iphone-pt",
      targetId: "iphone-1",
      platform: "ios",
      capabilities: ["screenshot"],
    },
  ]);
  current.screenVariants["cart-en"]!.rawAccessibilityTree!.bytes = 999;
  const frozenCartSource = compiled.plan.rawAccessibilitySourcesByScreenId?.cart?.[0];
  assert.equal(frozenCartSource?.tree?.bytes, 42);
  assert.equal(compiled.plan.rawAccessibilityTreesByScreenId, undefined);
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
        documentOriginProof: {
          schemaVersion: 1,
          method: "frozen-origin-match",
          firstViewport: {
            screenshotSha256: digest,
            accessibilityTreeSha256: digest,
          },
          attestation: {
            ...evidence("origin-attestation", "application/json"),
            mime: "application/json",
          },
          authorization: {
            schemaVersion: 1,
            issuer: "relay-local-capture",
            signature: "s".repeat(43),
          },
        },
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
    evidenceIds: ["shot", "tree", "origin-attestation", "composite", "merged", "manifest"],
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
      documentOrigin: {
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
      documentOriginProof: {
        schemaVersion: 1,
        method: "frozen-origin-match",
        firstViewport: {
          screenshotSha256: digest,
          accessibilityTreeSha256: digest,
        },
        attestation: {
          ...evidence("origin-attestation", "application/json"),
          mime: "application/json",
        },
        authorization: {
          schemaVersion: 1,
          issuer: "relay-local-capture",
          signature: "s".repeat(43),
        },
      },
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
  delete provisionalBaseline.documentOriginProof;
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
  const midPageBaselineMap = structuredClone(current);
  // This can occur on an imported/older surface even though the ordinary map
  // shape is still parseable. It is a first raw frame, not a document origin,
  // and therefore must never grant the fast-origin capability.
  midPageBaselineMap.screenVariants["cart-en"]!.scrollSurfaces![0]!.viewports[0]!.appendedHeight =
    40;
  const midPageCapture = Object.values(compileAppMapTest(midPageBaselineMap, work).graph)
    .flatMap((recipe) => recipe.steps)
    .find((step) => step.kind === "capture-surface");
  assert.equal(midPageCapture?.kind, "capture-surface");
  if (midPageCapture?.kind === "capture-surface") {
    assert.equal(midPageCapture.baselineTrust, "recapture-required");
    assert.equal(midPageCapture.documentOrigin, undefined);
    assert.match(midPageCapture.baselineTrustReason ?? "", /proven frozen first viewport/u);
  }
  const legacyBaselineMap = structuredClone(current);
  delete legacyBaselineMap.screenVariants["cart-en"]!.scrollSurfaces![0]!.documentOriginProof;
  const legacyCapture = Object.values(compileAppMapTest(legacyBaselineMap, work).graph)
    .flatMap((recipe) => recipe.steps)
    .find((step) => step.kind === "capture-surface");
  assert.equal(legacyCapture?.kind, "capture-surface");
  if (legacyCapture?.kind === "capture-surface") {
    assert.equal(legacyCapture.baselineTrust, "recapture-required");
    assert.equal(legacyCapture.documentOrigin, undefined);
    assert.match(legacyCapture.baselineTrustReason ?? "", /proven frozen first viewport/u);
  }
  assert.throws(
    () =>
      compileAppMapTest(current, work, {
        forceRecaptureSurfaceScreenIds: ["missing-surface"],
      }),
    /no full-surface binding for missing-surface/u,
  );
});

test("every-screen capture permits forced recapture without explicit surface bindings", () => {
  const current = fixture();
  const work = scenario();
  work.steps = [work.steps[0]!];
  work.capture = { mode: "every-screen" };

  const compiled = compileAppMapTest(current, work, {
    forceRecaptureSurfaceScreenIds: ["cart"],
  });
  assert.equal(
    Object.values(compiled.graph)
      .flatMap((recipe) => recipe.steps)
      .some((step) => step.kind === "screenshot"),
    true,
  );

  const checkpointed = scenario();
  checkpointed.steps = [checkpointed.steps[0]!];
  checkpointed.capture = { mode: "checkpoints", screenIds: ["cart"] };
  assert.throws(
    () =>
      compileAppMapTest(current, checkpointed, {
        forceRecaptureSurfaceScreenIds: ["cart"],
      }),
    /no full-surface binding for cart/u,
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

test("compiles a product file upload as coverage, not a cold device reset", () => {
  const map = fixture();
  map.connections["upload-pdf"] = {
    ...scope,
    id: "upload-pdf",
    fromScreenId: "home",
    destination: { kind: "end" },
    label: "Upload a file",
    state: "ready",
    actions: [
      {
        id: "upload-pdf",
        kind: "steps",
        steps: [
          {
            kind: "upload",
            file: "tests/fixtures/sample.pdf",
            target: { label: "Upload a file" },
          },
        ],
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  const instruction = structuredClone(work.steps[0]!);
  assert.equal(instruction.kind, "instruction");
  if (instruction.kind !== "instruction") {
    throw new Error("Expected the first scenario step to be an instruction");
  }
  instruction.id = "upload";
  instruction.intent = "Upload a fixture";
  instruction.binding = {
    status: "resolved",
    kind: "connections",
    connectionIds: ["upload-pdf"],
  };
  work.steps = [instruction];
  const compiled = compileAppMapTest(map, work);
  assert.equal(
    Object.values(compiled.graph).some((recipe) =>
      recipe.steps.some((step) => step.kind === "upload"),
    ),
    true,
  );
});

test("iOS upload is a compile-time blocker, not a runtime surprise", () => {
  const map = fixture();
  const iosProfile = {
    id: "ipad",
    targetId: "ipad-1",
    source: "device",
    platform: "ios",
    name: "iPad",
    capabilities: ["tap", "screenshot"],
    observedAt: at,
  } satisfies TargetProfile;
  map.screens.home = { ...map.screens.home!, variantIds: ["ios-home"] };
  map.screenVariants["ios-home"] = {
    ...scope,
    id: "ios-home",
    screenId: "home",
    targetProfile: iosProfile,
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
  map.connections["upload-pdf"] = {
    ...scope,
    id: "upload-pdf",
    fromScreenId: "home",
    destination: { kind: "end" },
    label: "Upload a file",
    state: "ready",
    actions: [
      {
        id: "upload-pdf",
        kind: "steps",
        steps: [
          {
            kind: "upload",
            file: "tests/fixtures/sample.pdf",
            target: { label: "Upload a file" },
          },
        ],
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  const instruction = structuredClone(work.steps[0]!);
  assert.equal(instruction.kind, "instruction");
  if (instruction.kind !== "instruction") {
    throw new Error("Expected the first scenario step to be an instruction");
  }
  instruction.id = "upload";
  instruction.intent = "Upload a fixture";
  instruction.binding = {
    status: "resolved",
    kind: "connections",
    connectionIds: ["upload-pdf"],
  };
  work.steps = [instruction];
  assert.throws(
    () =>
      compileAppMapTest(map, work, {
        runtimeTargetProfile: {
          id: "ipad",
          targetId: "ipad-1",
          platform: "ios",
          capabilities: ["screenshot", "tap"],
        },
      }),
    (error: unknown) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unsupported-platform" &&
      /Files-app/u.test(error.message),
  );
});

test("browser-recorded Tests compile Android as disabled, not invented routes", () => {
  const map = fixture();
  const browserProfile = {
    id: "browser:grok-com",
    targetId: "grok-com",
    source: "browser",
    platform: "browser",
    name: "Grok.com",
    capabilities: ["tap", "screenshot"],
    observedAt: at,
  } satisfies TargetProfile;
  map.screens.home = { ...map.screens.home!, variantIds: ["web-home"] };
  map.screenVariants["web-home"] = {
    ...scope,
    id: "web-home",
    screenId: "home",
    targetProfile: browserProfile,
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  work.capture = { mode: "final-screen" };
  work.nativeRouteCompanions = [
    {
      platform: "android",
      appMapId: "grok-android",
      testId: "test-grok-android-home-chrome",
    },
  ];
  const compiled = compileAppMapTest(map, work, {
    runtimeTargetProfile: {
      id: "pixel",
      targetId: "pixel-1",
      platform: "android",
    },
  });
  assert.ok((compiled.plan.omittedSteps?.length ?? 0) >= 1);
  assert.match(compiled.plan.omittedSteps?.[0]?.reason ?? "", /Grok Settings/u);
  assert.equal(compiled.plan.performance.executableOperations, 0);
  assert.equal(compiled.root.steps.filter((step) => step.kind === "screenshot").length, 0);
});

test("disabled steps stay in the document and are omitted from execution", () => {
  const work = scenario();
  const first = structuredClone(work.steps[0]!);
  work.steps = [
    {
      ...first,
      execution: {
        status: "disabled",
        reason: "No recorded Android route. Do not invent Grok Settings navigation.",
        repairTargetId: "open-cart",
        decidedBy: "reviewer",
        decidedAt: at,
      },
    },
  ];
  const compiled = compileAppMapTest(fixture(), work);
  assert.equal(compiled.plan.omittedSteps?.length, 1);
  assert.match(compiled.plan.omittedSteps?.[0]?.reason ?? "", /Android/u);
});

function destEndPrimitiveWork(
  map: ReturnType<typeof fixture>,
  connectionId: string,
  actions: NonNullable<ReturnType<typeof fixture>["connections"][string]>["actions"],
): ReturnType<typeof scenario> {
  map.connections[connectionId] = {
    ...scope,
    id: connectionId,
    fromScreenId: "home",
    destination: { kind: "end" },
    label: connectionId,
    state: "ready",
    actions,
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  const instruction = structuredClone(work.steps[0]!);
  assert.equal(instruction.kind, "instruction");
  if (instruction.kind !== "instruction") {
    throw new Error("Expected the first scenario step to be an instruction");
  }
  instruction.id = connectionId;
  instruction.intent = connectionId;
  instruction.binding = {
    status: "resolved",
    kind: "connections",
    connectionIds: [connectionId],
  };
  work.steps = [instruction];
  return work;
}

test("dest-end mobile-data and app.background compile as coverage primitives", () => {
  const map = fixture();
  const mobileData = destEndPrimitiveWork(map, "mobile-data", [
    {
      id: "toggle-data",
      kind: "steps",
      steps: [
        { kind: "wait-for", target: { label: "Google search" } },
        { kind: "settings", setting: "mobile-data", state: "off" },
        { kind: "settings", setting: "mobile-data", state: "on" },
        { kind: "wait-for", target: { label: "Google search" } },
      ],
    },
  ]);
  const compiledMobile = compileAppMapTest(map, mobileData);
  assert.equal(
    Object.values(compiledMobile.graph).some((recipe) =>
      recipe.steps.some((step) => step.kind === "settings" && step.setting === "mobile-data"),
    ),
    true,
  );
  assert.ok(compiledMobile.plan.destEndRecipeIds?.length);

  const background = destEndPrimitiveWork(map, "app-background", [
    {
      id: "background-chrome",
      kind: "steps",
      steps: [
        { kind: "wait-for", target: { label: "Google search" } },
        { kind: "app", action: "open", app: "com.android.chrome" },
        { kind: "app", action: "background", app: "com.android.chrome", backgroundMs: 1_000 },
        { kind: "wait-for", target: { label: "Search or type URL" } },
      ],
    },
  ]);
  const compiledBackground = compileAppMapTest(map, background);
  assert.equal(
    Object.values(compiledBackground.graph).some((recipe) =>
      recipe.steps.some((step) => step.kind === "app" && step.action === "background"),
    ),
    true,
  );
});

test("dest-end browser offline compiles as a coverage primitive", () => {
  const map = fixture();
  const work = destEndPrimitiveWork(map, "browser-offline", [
    {
      id: "toggle-offline",
      kind: "steps",
      steps: [
        { kind: "wait-for", target: { label: "Library" } },
        { kind: "offline", state: "on" },
        { kind: "offline", state: "off" },
        { kind: "wait-for", target: { label: "Library" } },
      ],
    },
  ]);
  const compiled = compileAppMapTest(map, work);
  assert.equal(
    Object.values(compiled.graph).some((recipe) =>
      recipe.steps.some((step) => step.kind === "offline"),
    ),
    true,
  );
});

test("dest-end offline on Android is a compile-time blocker, not a runtime surprise", () => {
  const map = fixture();
  const androidProfile = {
    id: "emulator-5554",
    targetId: "emulator-5554",
    source: "device",
    platform: "android",
    name: "Android emulator",
    capabilities: ["tap", "screenshot"],
    observedAt: at,
  } satisfies TargetProfile;
  map.screens.home = { ...map.screens.home!, variantIds: ["android-home"] };
  map.screenVariants["android-home"] = {
    ...scope,
    id: "android-home",
    screenId: "home",
    targetProfile: androidProfile,
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
  const work = destEndPrimitiveWork(map, "browser-offline", [
    {
      id: "toggle-offline",
      kind: "steps",
      steps: [
        { kind: "wait-for", target: { label: "Google search" } },
        { kind: "offline", state: "on" },
        { kind: "offline", state: "off" },
      ],
    },
  ]);
  assert.throws(
    () =>
      compileAppMapTest(map, work, {
        runtimeTargetProfile: {
          id: "emulator-5554",
          targetId: "emulator-5554",
          platform: "android",
          capabilities: ["screenshot", "tap"],
        },
      }),
    (error: unknown) =>
      error instanceof AppMapTestCompileError &&
      error.code === "unsupported-platform" &&
      /offline is a browser step/u.test(error.message),
  );
});

test("dest-end app.close still fails closed as a cold coverage effect", () => {
  const map = fixture();
  const work = destEndPrimitiveWork(map, "kill-chrome", [
    {
      id: "close",
      kind: "steps",
      steps: [{ kind: "app", action: "close", app: "com.android.chrome" }],
    },
  ]);
  assert.throws(
    () => compileAppMapTest(map, work),
    (error: unknown) =>
      error instanceof AppMapTestCompileError && error.code === "cold-coverage-effect",
  );
});

test("dest-screen settings stays a cold coverage effect", () => {
  const map = fixture();
  map.connections["open-cart"] = {
    ...map.connections["open-cart"]!,
    actions: [
      {
        id: "toggle-data",
        kind: "steps",
        steps: [{ kind: "settings", setting: "mobile-data", state: "off" }],
      },
    ],
  };
  assert.throws(
    () => compileAppMapTest(map, scenario()),
    (error: unknown) =>
      error instanceof AppMapTestCompileError && error.code === "cold-coverage-effect",
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
  assert.equal(firstRecipe?.steps[0]?.id?.endsWith("-live-entry"), true);
  assert.match(firstRecipe?.steps[0]?.id ?? "", /^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/u);
  assert.doesNotThrow(() => validateRecipeSteps(firstRecipe?.steps));
  assert.doesNotThrow(() =>
    createAppMapTestExecutionIntent({
      plan: compiled.plan,
      recipeGraph: compiled.graph,
      preflight: preflightCompiledAppMapTestOffline(compiled.plan),
    }),
  );
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
    preludeSteps: [{ kind: "tap", target: { identifier: "cart" } }],
    preludeStartFingerprint: "a".repeat(64),
  });
  assert.deepEqual(compiled.plan.stepProvenance[0]?.referencedEntityIds, ["cart"]);
});

test("layout assertions compile into the canonical cross-platform recipe step", () => {
  const work = scenario();
  work.steps = [
    {
      id: "layout-check",
      kind: "validation",
      intent: "The Arabic description and primary action do not overlap",
      binding: {
        status: "resolved",
        kind: "assertion",
        assertion: {
          kind: "layout",
          relation: "non-overlap",
          first: { identifier: "description" },
          second: { identifier: "primary-action" },
          timeoutMs: 0,
        },
      },
    },
  ];

  const compiled = compileAppMapTest(fixture(), work);
  assert.deepEqual(compiled.root.steps[0], {
    id: "relay-test-layout-check-1",
    kind: "assert-layout",
    relation: "non-overlap",
    first: { identifier: "description" },
    second: { identifier: "primary-action" },
    timeoutMs: 0,
  });
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

test("scrollable destination with every-screen compiles a destination survey that stay clones drop", () => {
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
      capabilities: ["screenshot", "snapshot", "scroll"],
      observedAt: at,
    },
    scrollCapturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: "Stable cart content should be captured completely.",
      decidedAt: at,
    },
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
  const work = scenario();
  work.steps = [work.steps[0]!];
  work.capture = { mode: "every-screen" };

  const compiled = compileAppMapTest(current, work);
  const expectations = Object.values(compiled.graph).flatMap((recipe) =>
    recipe.steps.filter(
      (step): step is Extract<RecipeStep, { kind: "expect-screen" }> =>
        step.kind === "expect-screen",
    ),
  );
  const destination = expectations.find((step) => step.id === "relay-destination-open-cart");
  assert.ok(destination);
  assert.deepEqual(destination.destinationSurvey, { maxScrolls: 4 });
  assert.equal(
    expectations.some((step) => step.id !== destination.id && step.destinationSurvey),
    false,
  );

  const stay = stayAppLocaleDestinationCheck(compiled.graph, compiled.root.id);
  assert.ok(stay?.kind === "expect-screen");
  assert.equal(stay.screenId, "cart");
  assert.equal(stay.destinationSurvey, undefined);
});

function superGrokLocaleTourMap(): AppMap {
  const map = fixture();
  map.screens.home!.title = "Home";
  map.screens.settings = {
    ...screen("settings"),
    title: "Settings",
    identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
  };
  map.screens.supergrok = {
    ...screen("supergrok"),
    title: "SuperGrok",
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.screens.composer = {
    ...screen("composer"),
    title: "Composer",
    identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
  };
  map.connections["open-settings"] = {
    ...scope,
    id: "open-settings",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "settings" },
    label: "Open Settings",
    state: "ready",
    actions: [{ id: "tap-settings", kind: "tap", target: { identifier: "settings_button" } }],
    createdAt: at,
    updatedAt: at,
  };
  map.connections["open-supergrok"] = {
    ...scope,
    id: "open-supergrok",
    fromScreenId: "settings",
    destination: { kind: "screen", screenId: "supergrok" },
    label: "Open SuperGrok",
    state: "ready",
    actions: [{ id: "tap-supergrok", kind: "tap", target: { label: "SuperGrok" } }],
    createdAt: at,
    updatedAt: at,
  };
  map.connections["dismiss-composer"] = {
    ...scope,
    id: "dismiss-composer",
    fromScreenId: "composer",
    destination: { kind: "screen", screenId: "home" },
    label: "Close composer",
    state: "ready",
    actions: [{ id: "tap-close", kind: "tap", target: { label: "Close" } }],
    createdAt: at,
    updatedAt: at,
  };
  return map;
}

test("a SuperGrok-starting Test compiles mapped home/settings inbound as prelude", () => {
  const map = superGrokLocaleTourMap();
  const work: AppMapScenarioTest = {
    ...scope,
    id: "supergrok-locale-tour",
    name: "SuperGrok locale tour",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "on-supergrok",
        kind: "validation",
        intent: "On SuperGrok",
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: { kind: "screen", screenId: "supergrok" },
        },
      },
      {
        id: "see-billing",
        kind: "validation",
        intent: "Manage billing is visible",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: { kind: "expect", target: { label: "Manage billing" }, condition: "visible" },
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };

  const compiled = compileAppMapTest(map, work);
  const first = compiled.root.steps[0];
  assert.equal(first?.kind, "expect-screen");
  assert.equal(first.kind === "expect-screen" ? first.screenId : undefined, "supergrok");
  assert.ok(first && "preludeSteps" in first);
  assert.deepEqual(first.preludeSteps, [
    { kind: "tap", target: { identifier: "settings_button" } },
    { kind: "tap", target: { label: "SuperGrok" } },
  ]);
  assert.ok("preludeStartFingerprint" in first);
  assert.equal(first.preludeStartFingerprint, "a".repeat(64));
});

test("manual screen refresh preserves a saved Test's frozen replay evidence profiles", () => {
  const current = fixture();
  const original: AppMap["screenVariants"][string] = {
    ...scope,
    id: "cart-saved",
    screenId: "cart",
    createdAt: at,
    updatedAt: at,
    evidenceIds: [],
    targetProfile: {
      id: "device:emulator-5554",
      targetId: "emulator-5554",
      source: "device",
      platform: "android",
      name: "Pixel",
      capabilities: [],
      observedAt: at,
    },
  };
  current.screenVariants[original.id] = original;
  current.screens.cart!.variantIds = [original.id];
  const before = compileAppMapTest(current, scenario()).plan;
  const refresh = {
    ...structuredClone(original),
    id: "cart-refresh",
    refreshCapture: { captureId: "manual-capture", capturedAt: 2 },
    targetProfile: {
      ...original.targetProfile,
      id: "device:emulator-5554-1080x2400",
      viewport: { width: 1080, height: 2400 },
    },
  };
  current.screenVariants[refresh.id] = refresh;
  current.screens.cart!.variantIds.push(refresh.id);
  const after = compileAppMapTest(current, scenario()).plan;
  assert.deepEqual(after.rawAccessibilityTargetProfiles, before.rawAccessibilityTargetProfiles);
  assert.deepEqual(
    after.rawAccessibilityVariantsByScreenId,
    before.rawAccessibilityVariantsByScreenId,
  );
  assert.deepEqual(
    after.rawAccessibilitySourcesByScreenId,
    before.rawAccessibilitySourcesByScreenId,
  );
  assert.equal(current.screenVariants[refresh.id]!.targetProfile.id, refresh.targetProfile.id);
});
