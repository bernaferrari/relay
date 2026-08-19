import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapCombine, AppMapTest, AppMapVariable } from "@relay/protocol";
import { SCREEN_CARD_WIDTH } from "./app-map-canvas-layout";
import { canvasCombineCards } from "./app-map-combine-canvas";

const scope = { organizationId: "org", projectId: "p", appMapId: "map-1" };
const at = 1;

const language: AppMapVariable = {
  ...scope,
  id: "language",
  name: "Language",
  kind: "language",
  apply: { kind: "list" },
  options: [
    { id: "en", label: "English" },
    { id: "it", label: "Italiano" },
  ],
  createdAt: at,
  updatedAt: at,
};

const scenario: AppMapTest = {
  ...scope,
  id: "settings-tour",
  name: "Open every Settings row",
  kind: "scenario",
  intentSchemaVersion: 1,
  steps: [
    {
      id: "settings-visible",
      kind: "validation",
      intent: "Settings is visible",
      binding: {
        status: "resolved",
        kind: "assertion",
        assertion: { kind: "screen", screenId: "settings" },
      },
    },
  ],
  createdAt: at,
  updatedAt: at,
};

const combine: AppMapCombine = {
  ...scope,
  id: "language-x-tour",
  name: "Language × Open every Settings row",
  variableIds: ["language"],
  testIds: ["settings-tour"],
  strategy: "zip",
  createdAt: at,
  updatedAt: at,
};

const map = {
  combines: { [combine.id]: combine },
  tests: { [scenario.id]: scenario },
  variables: { [language.id]: language },
} as Pick<AppMap, "combines" | "tests" | "variables">;

test("Combine sits next to the test's root screen", () => {
  const cards = canvasCombineCards(map, (screenId) =>
    screenId === "settings" ? { position: { x: 120, y: 80 }, title: "Settings" } : undefined,
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.id, "language-x-tour");
  assert.equal(cards[0]?.name, "Language × Open every Settings row");
  assert.deepEqual(cards[0]?.variables, [
    { id: "language", name: "Language", values: ["English", "Italiano"] },
  ]);
  assert.deepEqual(cards[0]?.tests, ["Open every Settings row"]);
  assert.equal(cards[0]?.cellCount, 2);
  assert.deepEqual(cards[0]?.startsAt, {
    screenId: "settings",
    title: "Settings",
    position: { x: 120, y: 80 },
  });
  assert.deepEqual(cards[0]?.position, { x: 120 + SCREEN_CARD_WIDTH + 28, y: 80 });
});

test("an empty map has no Combine cards", () => {
  assert.deepEqual(
    canvasCombineCards({ combines: {}, tests: {}, variables: {} }, () => undefined),
    [],
  );
});

test("multiple state sets count worlds × tests instead of flattening their values", () => {
  const theme: AppMapVariable = {
    ...language,
    id: "theme",
    name: "Theme",
    kind: "theme",
    options: [
      { id: "light", label: "Light" },
      { id: "dark", label: "Dark" },
    ],
  };
  const secondScenario: AppMapTest = { ...scenario, id: "chat", name: "Send a message" };
  const multi: AppMapCombine = {
    ...combine,
    variableIds: [language.id, theme.id],
    testIds: [scenario.id, secondScenario.id],
    strategy: "cartesian",
  };
  const cards = canvasCombineCards(
    {
      combines: { [multi.id]: multi },
      tests: { [scenario.id]: scenario, [secondScenario.id]: secondScenario },
      variables: { [language.id]: language, [theme.id]: theme },
    },
    () => ({ position: { x: 0, y: 0 }, title: "Settings" }),
  );
  assert.equal(cards[0]?.cellCount, 8);
  assert.match(cards[0]?.name ?? "", /Language × Theme/);
});

test("canvas preview uses the value subset saved with the Combine", () => {
  const selected = { ...combine, selected: { language: ["it"] } };
  const cards = canvasCombineCards({ ...map, combines: { [selected.id]: selected } }, () => ({
    position: { x: 0, y: 0 },
    title: "Settings",
  }));

  assert.deepEqual(cards[0]?.variables[0]?.values, ["Italiano"]);
  assert.equal(cards[0]?.cellCount, 1);
});

test("canvas card reconnects the newest owned execution batch", () => {
  const cards = canvasCombineCards(map, () => ({ position: { x: 0, y: 0 }, title: "Settings" }), [
    {
      id: "run-en",
      action: "map-1",
      status: "ok",
      queuedAt: 10,
      logs: [],
      batchId: "batch-1",
      matrixCase: {
        kind: "combine",
        combineId: combine.id,
        world: "English",
        values: { language: "English" },
      },
    },
    {
      id: "run-it",
      action: "map-1",
      status: "error",
      queuedAt: 11,
      logs: [],
      batchId: "batch-1",
      matrixCase: {
        kind: "combine",
        combineId: combine.id,
        world: "Italiano",
        values: { language: "Italiano" },
      },
    },
  ] as never);

  assert.deepEqual(cards[0]?.run, {
    jobId: "run-it",
    batchId: "batch-1",
    complete: 2,
    total: 2,
    passed: 1,
    problems: 1,
    active: 0,
  });
});
