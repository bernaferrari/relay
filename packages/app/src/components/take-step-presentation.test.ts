import assert from "node:assert/strict";
import test from "node:test";
import { evidenceForStep } from "./take-step-presentation";

test("evidenceForStep tolerates an empty Take selection", () => {
  assert.equal(evidenceForStep(undefined), undefined);
});
