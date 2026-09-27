import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCanonicalProductModel } from "./check-canonical-product-model.mjs";

const canonicalEntries = [
  {
    path: "packages/protocol/src/app-map-operation-definitions.ts",
    source: 'define("app-map.variable.infer")',
  },
  {
    path: "packages/server/src/app-map-capture-routes.ts",
    source: 'matchPath(pathname, "/app-maps/:appMapId/variables/:variableId/infer")',
  },
  {
    path: "packages/cli/src/cli-operation-descriptors.ts",
    source: '"app-map.variable.infer"',
  },
  { path: "packages/mcp/src/tools.ts", source: '"app-map.variable.infer"' },
];

test("accepts the one canonical Variable teaching path", () => {
  assert.deepEqual(evaluateCanonicalProductModel(canonicalEntries), []);
});

test("rejects retired models in names and source", () => {
  const violations = evaluateCanonicalProductModel([
    ...canonicalEntries,
    { path: "packages/server/src/retired-profile-routes.ts", source: "language-profile" },
    { path: "packages/app/src/legacy.ts", source: "locale matrix" },
  ]);
  assert.ok(violations.some((item) => item.includes("retired product-model vocabulary")));
});
