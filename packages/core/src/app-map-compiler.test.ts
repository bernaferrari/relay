import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapEntity, Connection, Routine, Screen } from "@relay/protocol";
import { AppMapCompileError, compileAppMapFlow } from "./app-map-compiler.js";

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
      { id: "continue", kind: "tap", target: { label: "Continue" } },
    ],
  };
  return {
    schemaVersion: 2,
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
        variableIds: ["thinking-level"],
        strategy: "zip",
        maxCases: 10,
      },
    },
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
    },
    {
      id: "relay-action-use-sign-in",
      kind: "module",
      recipeId: routineId,
      bindings: { email: "{{account_email}}" },
    },
    { id: "relay-action-continue", kind: "tap", target: { label: "Continue" } },
    {
      id: "relay-destination-open-home",
      kind: "expect-screen",
      screenId: "home",
      screenTitle: "Home",
      fingerprint: "b".repeat(64),
    },
  ]);
  assert.deepEqual(plan.recipes[routineId]!.steps, [
    { id: "relay-action-enter-email", kind: "type", text: "{{email}}" },
  ]);
  assert.deepEqual(plan.connections[0]!.compiledStepRange, [1, 4]);
  assert.equal(root.stepProvenance[0]!.origin, "source");
  assert.equal(root.stepProvenance[3]!.origin, "destination");
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
