import assert from "node:assert/strict";
import test from "node:test";
import { evidenceForStep } from "./journey-step-presentation";

test("evidenceForStep tolerates an empty selection while a test opens", () => {
  assert.equal(evidenceForStep(undefined), undefined);
});
