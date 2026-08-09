import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCombine } from "@relay/protocol";
import { combineWithoutVariable } from "./app-map-combine-edit";

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

test("removing a modifier also removes its saved value subset", () => {
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
