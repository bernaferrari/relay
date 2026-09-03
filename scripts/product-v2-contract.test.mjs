import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductV2Contract, findProductV2AdvancedVocabulary, loadProductV2Contract, PRODUCT_V2_ADVANCED_TERMS, PRODUCT_V2_OVERLAY_PRIORITY, PRODUCT_V2_ROUTES } from "./product-v2-contract.mjs";

test("PRODUCT_V2.md satisfies the executable route and vocabulary contract", async () => {
  assert.deepEqual(evaluateProductV2Contract({ document: await loadProductV2Contract() }), []);
});

test("route fixture is canonical and overlay priority is deterministic", () => {
  assert.equal(new Set(PRODUCT_V2_ROUTES).size, PRODUCT_V2_ROUTES.length);
  assert.deepEqual(PRODUCT_V2_OVERLAY_PRIORITY, ["menu", "popover", "inline editor", "dialog", "sheet", "temporary inspector", "canvas selection"]);
});

test("advanced engine nouns are explicit and cannot be silently public", () => {
  const document = "## Promise and public model\n## Canonical routes\n## Interaction laws\n## Responsive and accessibility contract\n## Public vocabulary boundary\n## Legacy expansion freeze and deletion targets";
  const violations = evaluateProductV2Contract({ document, advancedTerms: PRODUCT_V2_ADVANCED_TERMS.slice(0, -1) });
  assert.ok(violations.some((violation) => violation.includes("advanced term missing")));
});

test("ordinary UI copy can be checked for advanced engine vocabulary", () => {
  assert.deepEqual(findProductV2AdvancedVocabulary("Run this Test on a Device"), []);
  assert.deepEqual(findProductV2AdvancedVocabulary("Open the Variable Combine Cell details"), ["Variable", "Combine", "Cell"]);
});
