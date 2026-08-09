import assert from "node:assert/strict";
import test from "node:test";
import {
  combineCells,
  combineHeadline,
  combineSubhead,
  combineValueLabel,
} from "./app-map-combine-presentation";

test("Combine names a cell from the visible label", () => {
  assert.equal(combineValueLabel({ id: "it", label: "Italiano" }), "Italiano");
  assert.equal(combineValueLabel({ id: "pt", text: "Português" }), "Português");
  assert.equal(combineValueLabel({ id: "en" }), "en");
});

test("Combine headline is Variable × Test when the grid has more than one cell", () => {
  assert.equal(
    combineHeadline({
      variableName: "Language",
      testName: "Open every Settings row",
      cellCount: 15,
    }),
    "Language × Open every Settings row",
  );
  assert.equal(
    combineHeadline({
      variableName: "Language",
      testName: "Open every Settings row",
      cellCount: 1,
    }),
    "Open every Settings row",
  );
});

test("Combine subhead tells you what to do next", () => {
  assert.match(
    combineSubhead({ cellCount: 0, hasVariable: false, hasTest: false }),
    /record a path/i,
  );
  assert.match(combineSubhead({ cellCount: 0, hasVariable: false, hasTest: true }), /list/i);
  assert.match(combineSubhead({ cellCount: 15, hasVariable: true, hasTest: true }), /15 runs/);
});

test("Combine cells are a visible matrix, not a hidden job", () => {
  assert.deepEqual(
    combineCells(
      [
        { id: "en", label: "English" },
        { id: "it", label: "Italiano" },
      ],
      [{ id: "settings-tour", name: "Open every Settings row", kind: "tour" }],
    ),
    [
      {
        valueId: "en",
        testId: "settings-tour",
        valueLabel: "English",
        testName: "Open every Settings row",
      },
      {
        valueId: "it",
        testId: "settings-tour",
        valueLabel: "Italiano",
        testName: "Open every Settings row",
      },
    ],
  );
});
