import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCombine, AppMapVariable } from "@relay/protocol";
import { combineWithoutVariable, initialCombineDraft } from "./app-map-combine-edit";

const combine: AppMapCombine = {
  id: "matrix",
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
  name: "Language × Theme × Settings",
  variableIds: ["language", "theme"],
  testIds: ["settings"],
  selected: { language: ["en", "it"], theme: ["dark"] },
  strategy: "cartesian",
  createdAt: 1,
  updatedAt: 1,
};

test("removing a Variable also removes its saved value subset", () => {
  assert.deepEqual(combineWithoutVariable(combine, "language", 2), {
    ...combine,
    variableIds: ["theme"],
    selected: { theme: ["dark"] },
    updatedAt: 2,
  });
  assert.equal(
    combineWithoutVariable({ ...combine, variableIds: ["language"] }, "language", 2),
    null,
  );
});

test("a new matrix starts empty instead of silently choosing arbitrary inputs", () => {
  assert.deepEqual(initialCombineDraft(undefined, {}, ["settings"]), {
    variableIds: [],
    testIds: [],
    selected: {},
  });
});

test("a saved matrix restores only inputs that still exist", () => {
  const language = {
    id: "language",
    options: [{ id: "en" }, { id: "it" }],
  } as AppMapVariable;
  assert.deepEqual(
    initialCombineDraft(
      { ...combine, variableIds: ["language", "removed"], testIds: ["settings", "removed"] },
      { language },
      ["settings"],
    ),
    {
      variableIds: ["language"],
      testIds: ["settings"],
      selected: { language: ["en", "it"] },
    },
  );
});
