import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStepId, ensureStepId } from "./step-identity";

describe("step identity", () => {
  it("creates runner-neutral, unique editor identities", () => {
    const first = createStepId();
    const second = createStepId();
    assert.match(first, /^step-[A-Za-z0-9-]+$/);
    assert.notEqual(first, second);
  });

  it("does not replace an identity already attached to a step", () => {
    const step = { id: "step-existing", kind: "scroll" as const, direction: "down" as const };
    assert.equal(ensureStepId(step), step);
  });
});
