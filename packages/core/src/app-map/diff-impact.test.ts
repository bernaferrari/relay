import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapEntity, AppMapScenarioTest } from "@relay/protocol";
import { computeDiffImpact } from "./diff-impact.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "map" };

function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}

function emptyMap(): AppMap {
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    ...scope,
    name: "Store",
    revision: 1,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
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

function instruction(id: string, connectionIds: string[]): AppMapScenarioTest["steps"][number] {
  return {
    id,
    kind: "instruction",
    intent: `Walk ${connectionIds.join(",") || "nothing"}`,
    binding:
      connectionIds.length > 0
        ? { status: "resolved", kind: "connections", connectionIds }
        : { status: "unresolved", reason: "not bound yet" },
  };
}

function scenarioTest(id: string, steps: AppMapScenarioTest["steps"]): AppMapScenarioTest {
  return {
    ...entity(id),
    name: id,
    kind: "scenario",
    intentSchemaVersion: 1,
    steps,
  };
}

test("empty diff affects nothing", () => {
  const map = emptyMap();
  map.tests.checkout = scenarioTest("checkout", [instruction("s1", ["open-cart"])]);
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: [],
      sourcePaths: { "open-cart": ["src/cart/edge.ts"] },
    }),
    [],
  );
});

test("no mapping means no affected tests", () => {
  const map = emptyMap();
  map.connections["open-cart"] = {
    ...entity("open-cart"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cart" },
    state: "ready",
    actions: [],
  };
  map.tests.checkout = scenarioTest("checkout", [instruction("s1", ["open-cart"])]);
  // No sourcePaths supplied at all.
  assert.deepEqual(computeDiffImpact(map, { changedFiles: ["src/cart/edge.ts"] }), []);
  // Mapping present but for an unknown entity.
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/cart/edge.ts"],
      sourcePaths: { elsewhere: ["src/cart/edge.ts"] },
    }),
    [],
  );
});

test("entities without paths never match even when siblings do", () => {
  const map = emptyMap();
  map.connections.bound = {
    ...entity("bound"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cart" },
    state: "ready",
    actions: [],
  };
  map.connections.unmapped = {
    ...entity("unmapped"),
    fromScreenId: "cart",
    destination: { kind: "end" },
    state: "ready",
    actions: [],
  };
  map.tests.withPath = scenarioTest("with-path", [instruction("s1", ["bound"])]);
  map.tests.withoutPath = scenarioTest("without-path", [instruction("s2", ["unmapped"])]);
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/cart/edge.ts"],
      sourcePaths: { bound: ["src/cart/edge.ts"] },
    }),
    ["with-path"],
  );
});

test("longest prefix directory match wins over shallower matches", () => {
  const map = emptyMap();
  map.connections.deep = {
    ...entity("deep"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cart" },
    state: "ready",
    actions: [],
  };
  map.tests.ownedByDeep = scenarioTest("owned-by-deep", [instruction("s1", ["deep"])]);
  // `src/features/cart` is deeper than `src`; both match the changed file but
  // the deepest match decides which entities are affected.
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/features/cart/view.ts"],
      sourcePaths: {
        deep: ["src/features/cart"],
        shallow: ["src"],
      },
    }),
    ["owned-by-deep"],
  );
});

test("a file directly inside the mapped directory matches it", () => {
  const map = emptyMap();
  map.connections.edge = {
    ...entity("edge"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cart" },
    state: "ready",
    actions: [],
  };
  map.tests.smoke = scenarioTest("smoke", [instruction("s1", ["edge"])]);
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/cart/edge.ts"],
      sourcePaths: { edge: ["src/cart"] },
    }),
    ["smoke"],
  );
});

test("root-level files and root-level mapped paths never match", () => {
  const map = emptyMap();
  map.connections.edge = {
    ...entity("edge"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cart" },
    state: "ready",
    actions: [],
  };
  map.tests.smoke = scenarioTest("smoke", [instruction("s1", ["edge"])]);
  // A changed root file has no directory prefix, so it matches nothing.
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["README.md"],
      sourcePaths: { edge: ["README.md"] },
    }),
    [],
  );
  // A mapped bare filename also carries no directory prefix.
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/deep/file.ts"],
      sourcePaths: { edge: ["file.ts"] },
    }),
    [],
  );
});

test("matched routine expands through its transitive closure", () => {
  const map = emptyMap();
  map.routines["sign-in"] = {
    ...entity("sign-in"),
    name: "Sign in",
    parameters: [],
    actions: [{ id: "type-email", kind: "text", text: "{{email}}", target: { ref: "email" } }],
  };
  map.routines.wrapper = {
    ...entity("wrapper"),
    name: "Wrapper",
    parameters: [],
    actions: [{ id: "call-sign-in", kind: "routine", routineId: "sign-in" }],
  };
  map.connections.checkout = {
    ...entity("checkout"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cart" },
    state: "ready",
    actions: [{ id: "use-wrapper", kind: "routine", routineId: "wrapper" }],
  };
  map.flows.buy = {
    ...entity("buy"),
    name: "Buy",
    startScreenId: "home",
    connectionIds: ["checkout"],
  };
  map.tests.directRoutine = scenarioTest("direct-routine", [
    {
      id: "m1",
      kind: "module",
      intent: "Run wrapper",
      binding: { status: "resolved", kind: "routine", routineId: "sign-in" },
    },
  ]);
  map.tests.flowWalker = scenarioTest("flow-walker", [instruction("w1", ["checkout"])]);
  // Changing sign-in's own source touches both the module step that binds it
  // and the flow that reaches it through wrapper → checkout.
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/auth/signin.ts"],
      sourcePaths: { "sign-in": ["src/auth/signin.ts"] },
    }),
    ["direct-routine", "flow-walker"],
  );
});

test("nested decision and loop steps participate in matching", () => {
  const map = emptyMap();
  map.connections["open-deals"] = {
    ...entity("open-deals"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "deals" },
    state: "ready",
    actions: [],
  };
  map.tests.nested = scenarioTest("nested", [
    {
      id: "d1",
      kind: "decision",
      intent: "Maybe deals",
      binding: { status: "unresolved", reason: "manual branch" },
      thenSteps: [
        {
          id: "l1",
          kind: "loop",
          intent: "Sweep deals",
          binding: { status: "unresolved", reason: "repeat" },
          steps: [instruction("inner", ["open-deals"])],
        },
      ],
    },
  ]);
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/deals/screen.ts"],
      sourcePaths: { "open-deals": ["src/deals"] },
    }),
    ["nested"],
  );
});

test("output is sorted and de-duplicated across multiple matched files", () => {
  const map = emptyMap();
  map.connections.alpha = {
    ...entity("alpha"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cart" },
    state: "ready",
    actions: [],
  };
  map.connections.beta = {
    ...entity("beta"),
    fromScreenId: "cart",
    destination: { kind: "end" },
    state: "ready",
    actions: [],
  };
  map.tests.zulu = scenarioTest("zulu", [instruction("z1", ["alpha"])]);
  map.tests.alpha = scenarioTest("alpha", [instruction("a1", ["beta"])]);
  map.tests.both = scenarioTest("both", [
    instruction("b1", ["alpha"]),
    instruction("b2", ["beta"]),
  ]);
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/cart/x.ts", "src/cart/y.ts", "src/cart/x.ts"],
      sourcePaths: { alpha: ["src/cart"], beta: ["src/cart"] },
    }),
    ["alpha", "both", "zulu"],
  );
});

test("cleanup routines on instruction steps contribute impact", () => {
  const map = emptyMap();
  map.routines.logout = {
    ...entity("logout"),
    name: "Logout",
    parameters: [],
    actions: [{ id: "tap-logout", kind: "back" }],
  };
  map.tests.withCleanup = scenarioTest("with-cleanup", [
    {
      id: "c1",
      kind: "instruction",
      intent: "Browse then clean up",
      binding: { status: "unresolved", reason: "not bound" },
      cleanup: {
        kind: "routine",
        routineId: "logout",
        terminalScreenId: "home",
        onCancel: "skip",
      },
    },
  ]);
  assert.deepEqual(
    computeDiffImpact(map, {
      changedFiles: ["src/session/logout.ts"],
      sourcePaths: { logout: ["src/session/logout.ts"] },
    }),
    ["with-cleanup"],
  );
});
