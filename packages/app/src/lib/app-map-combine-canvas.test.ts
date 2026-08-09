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

const tour: AppMapTest = {
  ...scope,
  id: "settings-tour",
  name: "Open every Settings row",
  kind: "tour",
  rootScreenId: "settings",
  depth: 0,
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
  tests: { [tour.id]: tour },
  variables: { [language.id]: language },
  flows: {},
} as Pick<AppMap, "combines" | "tests" | "variables" | "flows">;

test("Combine sits next to the test's root screen", () => {
  const cards = canvasCombineCards(map, (screenId) =>
    screenId === "settings" ? { x: 120, y: 80 } : undefined,
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.id, "language-x-tour");
  assert.equal(cards[0]?.name, "Language → Open every Settings row");
  assert.deepEqual(cards[0]?.values, ["English", "Italiano"]);
  assert.deepEqual(cards[0]?.tests, ["Open every Settings row"]);
  assert.equal(cards[0]?.cellCount, 2);
  assert.deepEqual(cards[0]?.position, { x: 120 + SCREEN_CARD_WIDTH + 28, y: 80 });
});

test("an empty map has no Combine cards", () => {
  assert.deepEqual(
    canvasCombineCards({ combines: {}, tests: {}, variables: {}, flows: {} }, () => undefined),
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
  const secondTour: AppMapTest = { ...tour, id: "chat", name: "Send a message" };
  const multi: AppMapCombine = {
    ...combine,
    variableIds: [language.id, theme.id],
    testIds: [tour.id, secondTour.id],
    strategy: "cartesian",
  };
  const cards = canvasCombineCards(
    {
      combines: { [multi.id]: multi },
      tests: { [tour.id]: tour, [secondTour.id]: secondTour },
      variables: { [language.id]: language, [theme.id]: theme },
      flows: {},
    },
    () => ({ x: 0, y: 0 }),
  );
  assert.equal(cards[0]?.cellCount, 8);
  assert.match(cards[0]?.name ?? "", /Language × Theme/);
});
