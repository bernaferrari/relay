import assert from "node:assert/strict";
import test from "node:test";
import {
  combineCells,
  combineHeadline,
  combineSubhead,
  combineValueLabel,
  projectCombine,
  type CombineTestColumn,
  type CombineVariable,
} from "./app-map-combine-presentation";

const variables: CombineVariable[] = [
  {
    id: "language",
    name: "Language",
    values: [
      { id: "en", label: "English" },
      { id: "pt", label: "Português" },
    ],
  },
  {
    id: "theme",
    name: "Theme",
    values: [
      { id: "light", label: "Light" },
      { id: "dark", label: "Dark" },
    ],
  },
];
const tests: CombineTestColumn[] = [
  { id: "settings", name: "Visit Settings", kind: "scenario" },
  { id: "chat", name: "Send a message", kind: "scenario" },
];

test("run matrix labels visible values and its group-to-group formula", () => {
  assert.equal(combineValueLabel({ id: "it", label: "Italiano" }), "Italiano");
  assert.equal(combineValueLabel({ id: "pt", text: "Português" }), "Português");
  assert.equal(
    combineHeadline({
      variableNames: ["Language", "Theme"],
      testNames: ["Visit Settings", "Send a message"],
      cellCount: 8,
    }),
    "Language × Theme × (Visit Settings + Send a message)",
  );
});

test("a new matrix asks for the first visible decision", () => {
  assert.equal(
    combineSubhead({ cellCount: 0, hasVariable: false, hasTest: false }),
    "Choose a modifier such as language, account, or model.",
  );
  assert.equal(
    combineSubhead({ cellCount: 0, hasVariable: true, hasTest: false }),
    "Choose one or more paths to test.",
  );
});

test("cartesian projection makes every state combination × every test visible", () => {
  const projection = projectCombine(variables, tests, "cartesian");
  assert.equal(projection.totalWorlds, 4);
  assert.equal(projection.cellCount, 8);
  assert.deepEqual(
    projection.worlds.map((world) => world.label),
    [
      "Language: English · Theme: Light",
      "Language: English · Theme: Dark",
      "Language: Português · Theme: Light",
      "Language: Português · Theme: Dark",
    ],
  );
  assert.equal(combineCells(projection.worlds, tests).length, 8);
  assert.match(
    combineSubhead({
      cellCount: projection.cellCount,
      worldCount: projection.totalWorlds,
      testCount: tests.length,
      hasVariable: true,
      hasTest: true,
      screenshotCount: 70,
    }),
    /4 device runs · 8 checks.*70 screenshots/i,
  );
  assert.match(
    combineSubhead({
      cellCount: projection.cellCount,
      worldCount: projection.totalWorlds,
      testCount: tests.length,
      hasVariable: true,
      hasTest: true,
      screenshotCount: 0,
    }),
    /0 screenshots/i,
  );
});

test("matched rows explains mismatched set sizes instead of silently dropping values", () => {
  const projection = projectCombine(
    [
      variables[0]!,
      { ...variables[1]!, values: [...variables[1]!.values, { id: "system", label: "System" }] },
    ],
    tests,
    "zip",
  );
  assert.equal(projection.totalWorlds, 0);
  assert.match(projection.issue ?? "", /equally sized sets/i);
});

test("pairwise preview uses the same compact all-pairs plan as execution", () => {
  const projection = projectCombine(
    [
      variables[0]!,
      {
        ...variables[1]!,
        values: [...variables[1]!.values, { id: "system", label: "System" }],
      },
      {
        id: "account",
        name: "Account",
        values: [
          { id: "personal", label: "Personal" },
          { id: "work", label: "Work" },
        ],
      },
    ],
    tests,
    "pairwise",
  );
  assert.equal(projection.totalWorlds, 6);
  assert.equal(projection.cellCount, 12);
  assert.equal(projection.truncated, false);
});
