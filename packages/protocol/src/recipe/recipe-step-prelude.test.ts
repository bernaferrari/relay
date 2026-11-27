import assert from "node:assert/strict";
import test from "node:test";
import { recipeStepSchema } from "./recipe-step-schema.js";

const expectScreen = {
  kind: "expect-screen",
  screenId: "screen-1",
  screenTitle: "Home",
  fingerprint: "a".repeat(64),
};

const tour = { kind: "tour" };

test("expect-screen and tour accept gesture-only prelude steps", () => {
  for (const host of [expectScreen, tour]) {
    const result = recipeStepSchema.safeParse({
      ...host,
      preludeSteps: [{ kind: "key", key: "back" }],
    });
    assert.equal(result.success, true, `${host.kind} must accept a key prelude step`);
  }
  const tapHost = recipeStepSchema.safeParse({
    ...tour,
    preludeSteps: [{ kind: "tap", target: { label: "Open" } }],
  });
  assert.equal(tapHost.success, true);
});

test("expect-screen and tour reject non-gesture prelude steps", () => {
  for (const host of [expectScreen, tour]) {
    const result = recipeStepSchema.safeParse({
      ...host,
      preludeSteps: [{ kind: "type", text: "x" }],
    });
    assert.equal(result.success, false, `${host.kind} must reject a type prelude step`);
  }
});

test("tour prelude steps cap at 16", () => {
  const steps = Array.from({ length: 17 }, () => ({ kind: "key", key: "back" }));
  assert.equal(recipeStepSchema.safeParse({ ...tour, preludeSteps: steps }).success, false);
  const within = Array.from({ length: 16 }, () => ({ kind: "key", key: "back" }));
  assert.equal(recipeStepSchema.safeParse({ ...tour, preludeSteps: within }).success, true);
});

test("inbox steps have a strict type-code/open-link schema", () => {
  assert.equal(recipeStepSchema.safeParse({ kind: "inbox", action: "type-code" }).success, true);
  assert.equal(recipeStepSchema.safeParse({ kind: "inbox", action: "open-link" }).success, true);
  assert.equal(recipeStepSchema.safeParse({ kind: "inbox", action: "read-mail" }).success, false);
  for (const action of ["type-code", "open-link"] as const) {
    assert.equal(recipeStepSchema.safeParse({ kind: "inbox", action, secret: "x" }).success, false);
    assert.equal(
      recipeStepSchema.safeParse({ kind: "inbox", action, url: "https://example.test" }).success,
      false,
    );
  }
});
