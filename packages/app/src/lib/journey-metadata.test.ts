import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_JOURNEY_METADATA } from "./journey-metadata";

test("new Journey metadata starts with an empty graph and no renderer-owned Takes", () => {
  assert.equal(EMPTY_JOURNEY_METADATA.graph?.screens.length, 0);
  assert.equal(EMPTY_JOURNEY_METADATA.graph?.transitions.length, 0);
  assert.equal(EMPTY_JOURNEY_METADATA.takes?.length, 0);
});
