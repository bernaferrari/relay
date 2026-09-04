import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_V2_ADVANCED_TERMS,
  PRODUCT_V2_PUBLIC_OBJECTS,
  PRODUCT_V2_ROUTES,
  findProductV2AdvancedVocabulary,
} from "../../../scripts/product-v2-contract.mjs";
import { ROUTE_DEFINITIONS, routeMeta, routeUrls } from "./routes.js";

test("the executable Product V2 contract stays synchronized with the product registry", () => {
  assert.deepEqual(
    ROUTE_DEFINITIONS.map((definition) => definition.pattern),
    PRODUCT_V2_ROUTES,
  );
  for (const definition of ROUTE_DEFINITIONS) {
    assert.equal(routeMeta(definition.pattern).id, definition.id);
    assert.equal(PRODUCT_V2_ROUTES.includes(definition.pattern), true);
  }
});

test("canonical route metadata uses only public Product V2 vocabulary", () => {
  const routeText = JSON.stringify(ROUTE_DEFINITIONS);
  assert.deepEqual(findProductV2AdvancedVocabulary(routeText), []);
  for (const object of new Set(
    ROUTE_DEFINITIONS.flatMap((definition) =>
      definition.primaryObject ? [definition.primaryObject] : [],
    ),
  )) {
    assert.equal(
      PRODUCT_V2_PUBLIC_OBJECTS.includes(object),
      true,
      `route registry object ${object} is missing from the public contract`,
    );
  }
  assert.equal(PRODUCT_V2_ADVANCED_TERMS.includes("Lease"), true);
  assert.equal(routeUrls.sessions(), "/sessions");
  assert.equal(routeUrls.session("session/one"), "/sessions/session%2Fone");
});
