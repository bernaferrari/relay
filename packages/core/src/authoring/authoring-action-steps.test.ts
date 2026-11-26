import assert from "node:assert/strict";
import test from "node:test";
import { stepsForInteraction } from "./authoring-action-steps.js";
import { AuthoringStateError } from "./authoring-session-state.js";

test("recording into a password field keeps a reference and refuses a stored value", () => {
  assert.deepEqual(
    stepsForInteraction(
      { kind: "type", text: "{{password}}", target: { label: "Password" } },
      "action-1",
    ).map(({ id: _id, ...step }) => step),
    [{ kind: "type", text: "{{password}}", target: { label: "Password" } }],
  );
  assert.throws(
    () =>
      stepsForInteraction(
        { kind: "type", text: "hunter2", target: { label: "Password" } },
        "action-1",
      ),
    (error: unknown) =>
      error instanceof AuthoringStateError && /secret reference/u.test(error.message),
  );
});

test("recording a module refuses a stored password binding", () => {
  assert.throws(
    () =>
      stepsForInteraction(
        { kind: "reusable", recipeId: "login", bindings: { password: "hunter2" } },
        "action-1",
      ),
    (error: unknown) =>
      error instanceof AuthoringStateError && /secret reference/u.test(error.message),
  );
});
