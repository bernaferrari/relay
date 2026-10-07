import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, RecipeStep, TestData } from "@relay/protocol";
import { preflightAppMapCombine } from "./app-map-combine-preflight.js";
import { externalRecipeInputNames } from "./recipe-input-dependencies.js";
import { unusedInputDataSetWarnings } from "./app-map-combine-input-usage.js";
import type { Recipe } from "./recipes.js";
import {
  readProjectVariables,
  resetControlDatabaseCache,
  writeProjectVariables,
} from "./collaboration.js";
import { withControlStore } from "./collaboration-store.js";

const definition: TestData = {
  id: "project-chat-prompts",
  name: "chat_prompt",
  scope: "shared",
  source: "list",
  values: ["Explain a paper airplane", "Explain ocean tides"],
};

function entity(id: string) {
  return {
    id,
    organizationId: "org",
    projectId: "project",
    appMapId: "grok",
    createdAt: 1,
    updatedAt: 1,
  };
}

function work(id: string, steps: RecipeStep[]): { test: AppMapScenarioTest; steps: RecipeStep[] } {
  return {
    steps,
    test: {
      ...entity(id),
      name: id,
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [
        {
          id: `${id}-check`,
          kind: "instruction",
          intent: "Check the selected chat_prompt",
          binding: { status: "resolved", kind: "connections", connectionIds: [`${id}-path`] },
        },
      ],
    },
  };
}

function planMap(workItems: ReturnType<typeof work>[]): AppMap {
  const tests = workItems.map((item) => item.test);
  const variable = {
    ...entity("chat-data"),
    name: "Chat prompts",
    kind: "custom" as const,
    apply: { kind: "input" as const, inputId: definition.id },
    options: definition.values!.map((value, index) => ({
      id: `value-${index + 1}`,
      label: value,
      value,
    })),
  };
  const combine = {
    ...entity("prompt-checks"),
    name: "Prompt checks",
    variableIds: [variable.id],
    testIds: tests.map((item) => item.id),
    strategy: "zip" as const,
  };
  return {
    schemaVersion: 1,
    id: "grok",
    name: "Grok",
    organizationId: "org",
    projectId: "project",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    notes: {},
    groups: {},
    screens: {
      home: {
        ...entity("home"),
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [],
      },
    },
    screenVariants: {},
    connections: Object.fromEntries(
      workItems.map(({ test: item, steps }) => [
        `${item.id}-path`,
        {
          ...entity(`${item.id}-path`),
          fromScreenId: "home",
          destination: { kind: "screen", screenId: "home" },
          label: item.name,
          state: "ready",
          actions: [{ id: `${item.id}-actions`, kind: "steps", steps }],
        },
      ]),
    ),
    caseStacks: {},
    variables: { [variable.id]: variable },
    tests: Object.fromEntries(tests.map((item) => [item.id, item])),
    combines: { [combine.id]: combine },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
  };
}

function unusedWarnings(preflight: Awaited<ReturnType<typeof preflightAppMapCombine>>) {
  return preflight.warnings.filter((item) => item.code === "unused-input-data-set");
}

function recipe(id: string, steps: RecipeStep[]): Recipe {
  return { id, steps, title: id, source: "custom", createdAt: 1, updatedAt: 1 };
}

function knownGraphWarnings(graph: Record<string, Recipe>) {
  return unusedInputDataSetWarnings({
    variables: Object.values(planMap([]).variables),
    definitions: [definition],
    externalInputNames: new Set(externalRecipeInputNames(graph)),
  });
}

test("saved Plan preflight reports only proven unused public inputs without a connected device", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-plan-input-usage-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await writeProjectVariables("project", { expectedRevision: 0, value: [definition] });
    await t.test(
      "two prompt rows on an old New chat-only Test warn even while target bindings are absent",
      async () => {
        const map = planMap([work("old-fast", [{ kind: "tap", target: { label: "New chat" } }])]);
        const before = structuredClone(map);
        const preflight = await preflightAppMapCombine(map, map.combines["prompt-checks"]!);
        assert.equal(preflight.worlds, 2, JSON.stringify(preflight.blockers));
        assert.ok(preflight.blockers.some((item) => item.code === "zero-bindings"));
        assert.deepEqual(
          unusedWarnings(preflight).map(({ code, variableId, inputId, inputName }) => ({
            code,
            variableId,
            inputId,
            inputName,
          })),
          [
            {
              code: "unused-input-data-set",
              variableId: "chat-data",
              inputId: definition.id,
              inputName: definition.name,
            },
          ],
        );
        assert.match(unusedWarnings(preflight)[0]!.message, /Run input.*chat_prompt/);
        assert.equal(
          JSON.stringify(unusedWarnings(preflight)).includes(definition.values![0]!),
          false,
        );
        assert.deepEqual(map, before);
      },
    );
    await t.test("an ID or name alias consumed by any child keeps a mixed Plan valid", async () => {
      for (const alias of [definition.id, definition.name]) {
        const map = planMap([
          work("old-fast", [{ kind: "tap", target: { label: "New chat" } }]),
          work("parameterized-fast", [{ kind: "type", text: `{{${alias}}}` }]),
        ]);
        assert.deepEqual(
          unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)),
          [],
        );
      }
    });
    await t.test(
      "a preserved legacy public name uses runtime's trimmed alias without rewriting metadata",
      async () => {
        const current = await readProjectVariables("project");
        const legacy = { ...definition, name: "  chat_prompt  " };
        await withControlStore((store) =>
          store.upsertVariables("project", { ...current, value: [legacy] }),
        );
        try {
          const map = planMap([
            work("parameterized-fast", [{ kind: "type", text: "{{chat_prompt}}" }]),
          ]);
          assert.deepEqual(
            unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)),
            [],
          );
          assert.deepEqual((await readProjectVariables("project")).value, [legacy]);
        } finally {
          await withControlStore((store) => store.upsertVariables("project", current));
        }
      },
    );
    await t.test(
      "plain selector labels and authored descriptions do not consume an input",
      async () => {
        const map = planMap([
          work("named-chat_prompt", [{ kind: "tap", target: { label: "chat_prompt" } }]),
        ]);
        assert.equal(
          unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)).length,
          1,
        );
      },
    );
    await t.test(
      "a value produced earlier by the Test does not consume the Project input",
      async () => {
        const map = planMap([
          work("local-output", [
            { kind: "extract", target: { label: "Current prompt" }, as: "chat_prompt" },
            { kind: "type", text: "{{chat_prompt}}" },
          ]),
        ]);
        assert.equal(
          unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)).length,
          1,
        );
      },
    );
    await t.test(
      "complete recipe graphs keep branch-local outputs distinct from external input dependencies",
      () => {
        for (const hasElse of [true, false]) {
          const produced: RecipeStep = {
            kind: "extract",
            target: { label: "Current prompt" },
            as: "chat_prompt",
          };
          const graph = {
            root: recipe("root", [
              {
                kind: "branch",
                input: "state",
                operator: "exists",
                thenRecipeId: "then",
                ...(hasElse ? { elseRecipeId: "else" } : {}),
              },
              { kind: "type", text: "{{chat_prompt}}" },
            ]),
            then: recipe("then", [produced]),
            ...(hasElse ? { else: recipe("else", [produced]) } : {}),
          };
          assert.equal(knownGraphWarnings(graph).length, hasElse ? 1 : 0);
        }
      },
    );
    await t.test("complete recipe graphs respect reusable parameter scope", () => {
      const composer = {
        ...recipe("composer", [{ kind: "type", text: "{{chat_prompt}}" }]),
        parameters: [{ name: "chat_prompt", required: true }],
      };
      assert.equal(
        knownGraphWarnings({
          root: recipe("root", [
            { kind: "module", recipeId: "composer", bindings: { chat_prompt: "Fixed prompt" } },
          ]),
          composer,
        }).length,
        1,
      );
    });
    await t.test(
      "missing or unresolved Tests cannot establish that every child ignores the input",
      async () => {
        const map = planMap([work("old-fast", [{ kind: "tap", target: { label: "New chat" } }])]);
        map.combines["prompt-checks"]!.testIds.push("missing-test");
        assert.deepEqual(
          unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)),
          [],
        );
        map.combines["prompt-checks"]!.testIds.pop();
        map.tests["old-fast"]!.steps[0]!.binding = {
          status: "unresolved",
          reason: "No reviewed binding",
        };
        assert.deepEqual(
          unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)),
          [],
        );
      },
    );
    await t.test("a family requiring cell route binding remains unknown offline", async () => {
      const map = planMap([work("family-fast", [{ kind: "tap", target: { label: "New chat" } }])]);
      map.tests["family-fast"]!.family = {
        logicalIntentRevision: 1,
        bindingRevision: 1,
        routeVariants: [],
      };
      assert.deepEqual(
        unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)),
        [],
      );
    });
    await t.test(
      "missing recipe children or uncompiled native companions keep input usage unknown",
      async () => {
        const incomplete = planMap([
          work("missing-child", [{ kind: "module", recipeId: "missing-recipe" }]),
        ]);
        assert.deepEqual(
          unusedWarnings(
            await preflightAppMapCombine(incomplete, incomplete.combines["prompt-checks"]!),
          ),
          [],
        );
        const companion = planMap([
          work("web-fast", [{ kind: "tap", target: { label: "New chat" } }]),
        ]);
        companion.tests["web-fast"]!.nativeRouteCompanions = [
          { platform: "ios", appMapId: "grok-ios", testId: "native-fast" },
        ];
        assert.deepEqual(
          unusedWarnings(
            await preflightAppMapCombine(companion, companion.combines["prompt-checks"]!),
          ),
          [],
        );
      },
    );
    await t.test(
      "an unapproved, private, or ambiguous Project definition is not classified as an unused public input",
      async () => {
        for (const definitions of [
          [],
          [{ ...definition, values: ["Changed prompt"] }],
          [{ ...definition, scope: "private" as const, values: undefined }],
          [{ ...definition, sensitive: true }],
          [definition, { ...definition, id: "other", name: definition.id }],
        ]) {
          const map = planMap([work("old-fast", [{ kind: "tap", target: { label: "New chat" } }])]);
          const current = await readProjectVariables("project");
          await writeProjectVariables("project", {
            expectedRevision: current.revision,
            value: definitions,
          });
          assert.deepEqual(
            unusedWarnings(await preflightAppMapCombine(map, map.combines["prompt-checks"]!)),
            [],
          );
        }
      },
    );
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
