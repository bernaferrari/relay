import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listActionsWithTrace } from "./actions.js";

describe("listActionsWithTrace", () => {
  it("exposes the planned trace steps for every builtin action", () => {
    const alpha = listActionsWithTrace().find((a) => a.id === "update-last-alpha");
    assert.ok(alpha, "update-last-alpha missing from ACTIONS");
    assert.ok(alpha.planned, "planned steps missing");
    assert.ok(
      alpha.planned!.length >= 1,
      "expected at least one planned step for update-last-alpha",
    );
  });

  it("returns a planned array for every builtin action id", () => {
    for (const a of listActionsWithTrace()) {
      assert.ok(Array.isArray(a.planned), `${a.id} should carry a planned array`);
      assert.ok(a.planned!.length >= 1, `${a.id} should have at least one planned step`);
    }
  });
});
