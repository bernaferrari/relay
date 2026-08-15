import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapEntity, Connection, Routine, Screen } from "@relay/protocol";
import {
  AppMapCompileError,
  compileAppMapConnection,
  compileAppMapFlow,
} from "./app-map-compiler.js";

const at = 1_000;
const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };

function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}

function screen(id: string, title: string): Screen {
  const fingerprint = id === "welcome" ? "a".repeat(64) : "b".repeat(64);
  return {
    ...entity(id),
    title,
    identity: { schemaVersion: 1, fingerprint },
    variantIds: [],
  };
}

function fixture(): AppMap {
  const signIn: Routine = {
    ...entity("sign-in"),
    name: "Sign in",
    parameters: [{ name: "email", required: true }],
    actions: [{ id: "enter-email", kind: "text", text: "{{email}}" }],
  };
  const connection: Connection = {
    ...entity("open-home"),
    fromScreenId: "welcome",
    destination: { kind: "screen", screenId: "home" },
    caseStackId: "thinking-levels",
    state: "ready",
    actions: [
      {
        id: "use-sign-in",
        kind: "routine",
        routineId: signIn.id,
        bindings: { email: "{{account_email}}" },
      },
      {
        id: "continue",
        kind: "tap",
        target: { identifier: "continue-button" },
        fallbackTargets: [{ label: "Continue" }],
      },
    ],
  };
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Store",
    revision: 7,
    notes: {},
    groups: {},
    screens: {
      welcome: screen("welcome", "Welcome"),
      home: screen("home", "Home"),
    },
    screenVariants: {},
    connections: { [connection.id]: connection },
    caseStacks: {
      "thinking-levels": {
        ...entity("thinking-levels"),
        name: "Thinking levels",
        dataIds: ["thinking-level"],
        strategy: "zip",
        maxCases: 10,
      },
    },
    variables: {},
    tests: {},
    combines: {},
    routines: { [signIn.id]: signIn },
    flows: {
      checkout: {
        ...entity("checkout"),
        name: "Checkout",
        startScreenId: "welcome",
        connectionIds: [connection.id],
      },
    },
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("compiles an App Map flow into frozen runner recipes and destination verification", () => {
  const plan = compileAppMapFlow(fixture(), "checkout");
  const root = plan.recipes[plan.rootRecipeId]!;
  const routineId = "app-map:map-1:routine:sign-in:r7";

  assert.equal(plan.appMapRevision, 7);
  assert.deepEqual(
    plan.caseStacks.map((stack) => stack.id),
    ["thinking-levels"],
  );
  assert.equal(plan.connections[0]?.caseStackId, "thinking-levels");
  assert.deepEqual(plan.flow, {
    id: "checkout",
    name: "Checkout",
    startScreenId: "welcome",
  });
  assert.deepEqual(root.steps, [
    {
      id: "relay-source-checkout",
      kind: "expect-screen",
      screenId: "welcome",
      screenTitle: "Welcome",
      fingerprint: "a".repeat(64),
      timeoutMs: 5_000,
    },
    {
      id: "relay-action-use-sign-in",
      kind: "module",
      recipeId: routineId,
      bindings: { email: "{{account_email}}" },
    },
    {
      id: "relay-action-continue",
      kind: "tap",
      target: { identifier: "continue-button" },
      fallbackTargets: [{ label: "Continue" }],
    },
    {
      id: "relay-destination-open-home",
      kind: "expect-screen",
      screenId: "home",
      screenTitle: "Home",
      fingerprint: "b".repeat(64),
      timeoutMs: 5_000,
    },
  ]);
  assert.deepEqual(plan.recipes[routineId]!.steps, [
    { id: "relay-action-enter-email", kind: "type", text: "{{email}}" },
  ]);
  assert.deepEqual(plan.connections[0]!.compiledStepRange, [1, 4]);
  assert.equal(root.stepProvenance[0]!.origin, "source");
  assert.equal(root.stepProvenance[3]!.origin, "destination");
});

test("compiles mapped scroll navigation as a semantic reveal", () => {
  const map = fixture();
  map.connections["open-home"] = {
    ...map.connections["open-home"]!,
    actions: [
      {
        id: "scroll-home",
        kind: "gesture",
        gesture: { kind: "scroll", direction: "down", amount: 1 },
      },
    ],
  };
  const root = compileAppMapFlow(map, "checkout").recipes["app-map:map-1:flow:checkout:r7"]!;
  const scroll = root.steps.find(
    (step): step is Extract<(typeof root.steps)[number], { kind: "scroll" }> =>
      step.kind === "scroll",
  );

  assert.equal(scroll?.until?.screenId, "home");
  assert.equal(scroll?.until?.fingerprint, "b".repeat(64));
  assert.equal(scroll?.maxAttempts, 12);
});

test("compiles reveal-to-control as a first-class viewport-independent step", () => {
  const map = fixture();
  map.connections["open-home"]!.actions.unshift({
    id: "reveal-continue",
    kind: "reveal",
    target: { identifier: "continue-button", label: "Continue" },
    direction: "auto",
    maxAttempts: 16,
  });
  const root = compileAppMapFlow(map, "checkout").recipes["app-map:map-1:flow:checkout:r7"]!;
  const reveal = root.steps.find((step) => step.kind === "reveal");
  assert.deepEqual(reveal, {
    id: "relay-action-reveal-continue",
    kind: "reveal",
    target: { identifier: "continue-button", label: "Continue" },
    direction: "auto",
    maxAttempts: 16,
  });
});

test("compiles source full-surface semantic order into reveal navigation", () => {
  const map = fixture();
  const evidence = (id: string, digit: string, mime: "image/png" | "application/json") => ({
    id,
    uri: `relay-evidence://${digit.repeat(64)}`,
    sha256: digit.repeat(64),
    mime,
    bytes: 10,
  });
  const owned = [
    evidence("top-shot", "1", "image/png"),
    evidence("top-tree", "2", "application/json"),
    evidence("merged", "3", "application/json"),
    evidence("manifest", "4", "application/json"),
  ];
  map.screens.welcome!.variantIds = ["welcome-fr"];
  map.screenVariants["welcome-fr"] = {
    ...entity("welcome-fr"),
    screenId: "welcome",
    targetProfile: {
      id: "ipad-fr",
      targetId: "ipad-1",
      source: "device",
      platform: "ios",
      name: "iPad · Français",
      capabilities: ["scroll", "snapshot", "screenshot"],
      observedAt: at,
    },
    evidenceIds: owned.map(({ id }) => id),
    evidenceUris: owned.map(({ uri }) => uri),
    scrollSurfaces: [
      {
        schemaVersion: 1,
        id: "welcome-surface",
        captureId: "welcome-fr-r1",
        targetProfileId: "ipad-fr",
        capturePolicy: {
          captureMode: "full-surface",
          source: "explicit",
          reason: "Capture the complete settings list.",
          decidedAt: at,
        },
        capturedAt: at,
        status: "completed",
        reason: "end-of-content",
        message: "Complete surface",
        restoredStartViewport: true,
        viewports: [
          {
            index: 0,
            offsetY: 0,
            appendedHeight: 0,
            capturedAt: at,
            width: 1_000,
            height: 800,
            screenshot: { ...owned[0]!, mime: "image/png" },
            accessibilityTree: { ...owned[1]!, mime: "application/json" },
          },
        ],
        mergedTree: { ...owned[2]!, mime: "application/json", nodeCount: 2 },
        semanticIndex: {
          schemaVersion: 1,
          documentHeight: 2_400,
          viewportHeight: 800,
          anchors: [
            { order: 0, documentY: 240, target: { identifier: "appearance" } },
            { order: 1, documentY: 2_040, target: { identifier: "kids-mode" } },
          ],
        },
        manifest: { ...owned[3]!, mime: "application/json" },
      },
    ],
  };
  map.connections["open-home"]!.actions.unshift({
    id: "reveal-kids-mode",
    kind: "reveal",
    target: { identifier: "kids-mode", label: "Mode Enfant" },
    direction: "auto",
  });

  const root = compileAppMapFlow(map, "checkout").recipes["app-map:map-1:flow:checkout:r7"]!;
  const reveal = root.steps.find((step) => step.kind === "reveal");
  assert.equal(reveal?.kind, "reveal");
  if (reveal?.kind !== "reveal") return;
  assert.equal(reveal.navigation?.[0]?.surfaceId, "welcome-surface");
  assert.equal(reveal.navigation?.[0]?.targetOrder, 1);
  assert.deepEqual(
    reveal.navigation?.[0]?.anchors.map((anchor) => anchor.target),
    [{ identifier: "appearance" }, { identifier: "kids-mode" }],
  );
});

test("compiles a saved flow only through the selected connection", () => {
  const map = fixture();
  map.screens.receipt = {
    ...screen("receipt", "Receipt"),
    identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
  };
  map.connections["checkout-connection"] = {
    ...entity("checkout-connection"),
    id: "checkout-connection",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "receipt" },
    state: "ready",
    actions: [{ id: "pay", kind: "tap", target: { label: "Pay" } }],
  };
  map.flows.checkout!.connectionIds.push("checkout-connection");

  const plan = compileAppMapFlow(map, "checkout", { throughConnectionId: "open-home" });

  assert.deepEqual(
    plan.connections.map((connection) => connection.connectionId),
    ["open-home"],
  );
  assert.deepEqual(plan.terminal, { kind: "screen", screenId: "home" });
  assert.ok(
    plan.recipes[plan.rootRecipeId]!.steps.every(
      (step) => step.kind !== "expect-screen" || step.screenId !== "receipt",
    ),
  );
  assert.throws(
    () =>
      compileAppMapFlow(map, "checkout", {
        throughConnectionId: "not-in-this-flow",
      }),
    (error: unknown) => error instanceof AppMapCompileError && error.code === "missing-connection",
  );
});

test("compiles one connection from canonical actions with source and destination checks", () => {
  const plan = compileAppMapConnection(fixture(), "open-home");
  const root = plan.recipes[plan.rootRecipeId]!;

  assert.equal(plan.rootRecipeId, "app-map:map-1:connection:open-home:r7");
  assert.deepEqual(plan.connection, {
    id: "open-home",
    fromScreenId: "welcome",
    destination: { kind: "screen", screenId: "home" },
    caseStackId: "thinking-levels",
  });
  assert.deepEqual(
    root.steps.map((step) => step.kind),
    ["expect-screen", "module", "tap", "expect-screen"],
  );
  assert.deepEqual(
    root.stepProvenance.map((item) => item.origin),
    ["source", "action", "action", "destination"],
  );
  assert.deepEqual(
    plan.caseStacks.map((stack) => stack.id),
    ["thinking-levels"],
  );
});

test("compiles directly authored structured steps without inventing a recording", () => {
  const map = fixture();
  map.connections["open-home"]!.caseStackId = undefined;
  map.connections["open-home"]!.actions = [
    {
      id: "clipboard-fidelity",
      kind: "steps",
      steps: [
        {
          id: "paste",
          kind: "clipboard",
          action: "paste",
          text: "alpha\nbeta\ngamma",
          target: { identifier: "composer" },
        },
        {
          id: "copy",
          kind: "clipboard",
          action: "copy",
          target: { identifier: "composer" },
          expect: "alpha\nbeta\ngamma",
          match: "exact",
        },
      ],
    },
  ];

  const plan = compileAppMapFlow(map, "checkout");
  const root = plan.recipes[plan.rootRecipeId]!;
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "clipboard"),
    [
      {
        id: "paste",
        kind: "clipboard",
        action: "paste",
        text: "alpha\nbeta\ngamma",
        target: { identifier: "composer" },
      },
      {
        id: "copy",
        kind: "clipboard",
        action: "copy",
        target: { identifier: "composer" },
        expect: "alpha\nbeta\ngamma",
        match: "exact",
      },
    ],
  );
});

test("runs explicit Flow setup before verifying the entry screen", () => {
  const map = fixture();
  map.routines["start-clean"] = {
    ...entity("start-clean"),
    name: "Start clean",
    parameters: [{ name: "entry", required: true }],
    actions: [
      {
        id: "open-app",
        kind: "app",
        action: "open",
        app: "ai.x.GrokApp",
        relaunch: false,
      },
      { id: "compose", kind: "tap", target: { identifier: "{{entry}}" } },
    ],
  };
  map.flows.checkout!.setup = {
    routineId: "start-clean",
    bindings: { entry: "grok-compose" },
  };

  const plan = compileAppMapFlow(map, "checkout");
  const root = plan.recipes[plan.rootRecipeId]!;
  assert.deepEqual(plan.flow.setup, {
    routineId: "start-clean",
    bindings: { entry: "grok-compose" },
  });
  assert.deepEqual(root.steps.slice(0, 2), [
    {
      id: "relay-setup-checkout",
      kind: "module",
      recipeId: "app-map:map-1:routine:start-clean:r7",
      bindings: { entry: "grok-compose" },
    },
    {
      id: "relay-source-checkout",
      kind: "expect-screen",
      screenId: "welcome",
      screenTitle: "Welcome",
      fingerprint: "a".repeat(64),
      timeoutMs: 5_000,
    },
  ]);
  assert.equal(root.stepProvenance[0]!.origin, "setup");
  assert.equal(root.stepProvenance[1]!.origin, "source");
  assert.deepEqual(plan.connections[0]!.compiledStepRange, [2, 5]);
  assert.deepEqual(plan.recipes["app-map:map-1:routine:start-clean:r7"]!.steps, [
    {
      id: "relay-action-open-app",
      kind: "app",
      action: "open",
      app: "ai.x.GrokApp",
      relaunch: false,
    },
    {
      id: "relay-action-compose",
      kind: "tap",
      target: { identifier: "{{entry}}" },
    },
  ]);
});

test("refuses to run drafts and unverifiable destinations", () => {
  const draft = fixture();
  draft.connections["open-home"]!.state = "draft";
  assert.throws(
    () => compileAppMapFlow(draft, "checkout"),
    (error: unknown) => error instanceof AppMapCompileError && error.code === "draft-connection",
  );

  const missingIdentity = fixture();
  delete missingIdentity.screens.home!.identity;
  assert.throws(
    () => compileAppMapFlow(missingIdentity, "checkout"),
    (error: unknown) =>
      error instanceof AppMapCompileError && error.code === "missing-screen-identity",
  );
});

test("compiles approved semantic variants for dynamic destination matching", () => {
  const map = fixture();
  const observation = {
    fingerprint: "c".repeat(64),
    nodes: [{ role: "button", label: "copy message", identifier: "chat.copy" }],
    volatileSignals: [],
  };
  map.screens.home!.variantIds = ["home-phone"];
  map.screenVariants["home-phone"] = {
    ...entity("home-phone"),
    screenId: "home",
    targetProfile: {
      id: "pixel",
      targetId: "pixel",
      source: "device",
      platform: "android",
      name: "Pixel",
      capabilities: [],
      observedAt: at,
    },
    observation,
    evidenceIds: [],
  };

  const plan = compileAppMapFlow(map, "checkout");
  const destination = plan.recipes[plan.rootRecipeId]!.steps.at(-1);
  assert.equal(destination?.kind, "expect-screen");
  if (destination?.kind === "expect-screen") {
    assert.deepEqual(destination.observations, [observation]);
  }
});

test("compiled expectations retain every raw viewport absorbed into a logical screen", () => {
  const map = fixture();
  const currentObservation = {
    fingerprint: "c".repeat(64),
    nodes: [{ role: "button", label: "Top row" }],
    volatileSignals: [],
  };
  const archivedObservation = {
    fingerprint: "d".repeat(64),
    nodes: [{ role: "button", label: "Bottom row" }],
    volatileSignals: [],
  };
  const variant = {
    ...entity("home-phone"),
    screenId: "home",
    targetProfile: {
      id: "pixel",
      targetId: "pixel",
      source: "device" as const,
      platform: "android" as const,
      name: "Pixel",
      capabilities: [],
      observedAt: at,
    },
    observation: currentObservation,
    evidenceIds: [],
  };
  const archivedVariant = {
    ...variant,
    id: "home-phone-bottom",
    screenId: "home-bottom",
    observation: archivedObservation,
  };
  map.screens.home!.variantIds = [variant.id];
  map.screenVariants[variant.id] = variant;
  map.screens.home!.consolidations = [
    {
      eventId: "merge-home",
      actorId: "agent",
      at,
      sourceScreens: [
        {
          ...screen("home-bottom", "Home · Bottom"),
          identity: {
            schemaVersion: 1,
            fingerprint: "e".repeat(64),
            aliases: ["f".repeat(64)],
          },
          variantIds: [archivedVariant.id],
        },
      ],
      sourceVariants: [archivedVariant],
      internalConnections: [],
      preview: {} as NonNullable<Screen["consolidations"]>[number]["preview"],
    },
  ];

  const plan = compileAppMapFlow(map, "checkout");
  const destination = plan.recipes[plan.rootRecipeId]!.steps.at(-1);
  assert.equal(destination?.kind, "expect-screen");
  if (destination?.kind === "expect-screen") {
    assert.deepEqual(destination.observations, [currentObservation, archivedObservation]);
    assert.deepEqual(new Set(destination.aliases), new Set(["e".repeat(64), "f".repeat(64)]));
  }
});

test("preserves best-effort action policy in compiled recipes", () => {
  const map = fixture();
  map.connections["open-home"]!.actions = [
    {
      id: "dismiss-sidebar",
      kind: "tap",
      target: { identifier: "sidebar.close" },
      optional: true,
    },
  ];

  const plan = compileAppMapFlow(map, "checkout");
  assert.deepEqual(plan.recipes[plan.rootRecipeId]!.steps[1], {
    id: "relay-action-dismiss-sidebar",
    kind: "tap",
    target: { identifier: "sidebar.close" },
    optional: true,
  });
});

test("keeps passive transitions executable by verifying source and destination", () => {
  const map = fixture();
  map.connections["open-home"]!.actions = [
    { id: "automatic", kind: "passive", reason: "automatic" },
  ];
  const plan = compileAppMapFlow(map, "checkout");
  assert.deepEqual(
    plan.recipes[plan.rootRecipeId]!.steps.map((step) => step.kind),
    ["expect-screen", "expect-screen"],
  );
});

test("refuses to run when the flow entry screen has no approved identity", () => {
  const map = fixture();
  delete map.screens.welcome!.identity;
  assert.throws(
    () => compileAppMapFlow(map, "checkout"),
    (error: unknown) =>
      error instanceof AppMapCompileError && error.code === "missing-screen-identity",
  );
});
