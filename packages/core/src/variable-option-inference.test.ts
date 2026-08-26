import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  extractVariableOptionsFromNodes,
  inferOptionId,
  inferVariableOptionsFromTeach,
} from "./variable-option-inference.js";

test("stable option ids cover language and non-language Variables", () => {
  assert.equal(inferOptionId("English"), "en");
  assert.equal(inferOptionId("Português (Brasil)", "Portuguese (Brazil)"), "pt-BR");
  assert.equal(inferOptionId("Staging"), "staging");
  assert.equal(inferOptionId("Dark mode", "Dark"), "dark");
  assert.equal(inferOptionId("العربية", "Arabic"), "ar");
  assert.equal(
    inferOptionId("العربية (المملكة العربية السعودية)", "Arabic (Saudi Arabia)"),
    "ar-SA",
  );
});

test("Variable extraction ignores picker chrome and preserves row identifiers", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Table",
      label: "SUGGESTED LANGUAGES",
      rect: { x: 376, y: 0, width: 737, height: 834 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: "Cell",
      label: "English, Default",
      rect: { x: 600, y: 120, width: 480, height: 52 },
      hittable: true,
    },
    {
      index: 2,
      parentIndex: 0,
      type: "Cell",
      label: "Português (Brasil), Portuguese (Brazil)",
      rect: { x: 600, y: 180, width: 480, height: 52 },
      hittable: true,
    },
    {
      index: 3,
      parentIndex: 0,
      type: "Cell",
      label: "Italiano, Italian",
      rect: { x: 600, y: 240, width: 480, height: 52 },
      hittable: true,
    },
    {
      index: 4,
      parentIndex: 0,
      type: "Cell",
      label: "Airplane Mode",
      rect: { x: 20, y: 100, width: 400, height: 44 },
      hittable: true,
    },
  ];

  assert.deepEqual(
    extractVariableOptionsFromNodes(nodes).map((option) => option.id),
    ["en", "pt-BR", "it"],
  );
});

test("one or two taught rows anchor every inferred Variable option", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 1,
      type: "Cell",
      label: "English",
      identifier: "lang.en",
      rect: { x: 0, y: 10, width: 300, height: 44 },
      hittable: true,
    },
    {
      index: 2,
      type: "Cell",
      label: "Português (Brasil)",
      identifier: "lang.pt-BR",
      rect: { x: 0, y: 60, width: 300, height: 44 },
      hittable: true,
    },
    {
      index: 3,
      type: "Cell",
      label: "Italiano",
      rect: { x: 0, y: 110, width: 300, height: 44 },
      hittable: true,
    },
  ];
  assert.deepEqual(
    inferVariableOptionsFromTeach({
      nodes,
      taughtRows: [
        { id: "en", identifier: "lang.en" },
        { id: "pt-BR", label: "Português (Brasil)" },
      ],
    }),
    [
      { id: "en", label: "English", identifier: "lang.en" },
      { id: "pt-BR", label: "Português (Brasil)", identifier: "lang.pt-BR" },
      { id: "it", label: "Italiano" },
    ],
  );
});
