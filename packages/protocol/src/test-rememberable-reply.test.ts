import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Connection, Screen } from "./app-map.js";
import type { RecipeStep } from "./recipes.js";
import type { AppMapScenarioTest } from "./test-intent.js";
import { testHasRememberableReply } from "./test-rememberable-reply.js";

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

function connection(id: string, steps: RecipeStep[]): Connection {
  return {
    ...scope,
    id,
    fromScreenId: "home",
    destination: { kind: "end" },
    label: id,
    state: "ready",
    actions: [{ id: `${id}-steps`, kind: "steps", steps }],
    createdAt: at,
    updatedAt: at,
  };
}

function map(connections: Record<string, Connection>): AppMap {
  return {
    schemaVersion: 1,
    id: "grok-web",
    organizationId: "org",
    projectId: "project",
    name: "Grok.com daily",
    revision: 1,
    notes: {},
    groups: {},
    screens: { home: screen("home") },
    screenVariants: {},
    connections,
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

function bound(id: string, connectionId: string): AppMapScenarioTest {
  return {
    ...scope,
    id,
    createdAt: at,
    updatedAt: at,
    name: id,
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "step-action",
        intent: id,
        kind: "instruction",
        binding: { status: "resolved", kind: "connections", connectionIds: [connectionId] },
      },
    ],
  };
}

test("visual chrome Tests do not have a rememberable reply", () => {
  const chrome = map({
    home: connection("home", [
      {
        id: "wait-home",
        kind: "expect",
        target: { label: "What should we explore?" },
        condition: "visible",
      },
      { id: "judge", kind: "evaluate-visual", criteria: ["Composer is visible"] },
    ]),
  });
  assert.equal(testHasRememberableReply(bound("test-home-judged", "home"), chrome), false);
});

test("extract on a bound connection is a rememberable reply", () => {
  const threeByFive = map({
    "3x5": connection("3x5", [
      { as: "answer", id: "extract-answer", kind: "extract", target: { label: "assistant" } },
    ]),
  });
  assert.equal(testHasRememberableReply(bound("test-3x5", "3x5"), threeByFive), true);
});

test("a semantic checkpoint on the Test itself is a rememberable reply", () => {
  const semantic: AppMapScenarioTest = {
    ...bound("test-semantic", "home"),
    steps: [
      {
        id: "step-semantic",
        intent: "Judge the reply",
        kind: "validation",
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: { kind: "semantic", input: "reply", criteria: ["Mentions Paris"] },
        },
      },
    ],
  };
  assert.equal(testHasRememberableReply(semantic), true);
});
