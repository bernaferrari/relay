import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_ADVANCED_TERMS,
  PRODUCT_PUBLIC_OBJECTS,
  PRODUCT_ROUTES,
  findProductAdvancedVocabulary,
} from "../../../scripts/product-contract.mjs";
import { ROUTE_DEFINITIONS, routeMeta, routeUrls } from "./routes.js";

test("the executable Product contract stays synchronized with the product registry", () => {
  assert.deepEqual(
    ROUTE_DEFINITIONS.map((definition) => definition.pattern),
    PRODUCT_ROUTES,
  );
  for (const definition of ROUTE_DEFINITIONS) {
    assert.equal(routeMeta(definition.pattern).id, definition.id);
    assert.equal(PRODUCT_ROUTES.includes(definition.pattern), true);
  }
});

test("canonical route metadata uses only public Product vocabulary", () => {
  const routeText = JSON.stringify(ROUTE_DEFINITIONS);
  assert.deepEqual(findProductAdvancedVocabulary(routeText), []);
  for (const object of new Set(
    ROUTE_DEFINITIONS.flatMap((definition) =>
      definition.primaryObject ? [definition.primaryObject] : [],
    ),
  )) {
    assert.equal(
      PRODUCT_PUBLIC_OBJECTS.includes(object),
      true,
      `route registry object ${object} is missing from the public contract`,
    );
  }
  assert.equal(PRODUCT_ADVANCED_TERMS.includes("Lease"), true);
  assert.equal(routeUrls.sessions(), "/sessions");
  assert.equal(routeUrls.session("session/one"), "/sessions/session%2Fone");
});
