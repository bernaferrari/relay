import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_INPUT,
  redactPrivateJobs,
  redactPrivateValue,
  referencedRecipeInputNames,
  referencedRuntimeInputs,
  referencedVariableIds,
  sensitiveInputNames,
} from "./private-inputs.js";
import type { Recipe } from "./recipes.js";

const recipe: Recipe = {
  id: "sign-in",
  title: "Sign in",
  source: "custom",
  createdAt: 1,
  updatedAt: 1,
  steps: [
    { kind: "type", text: "{{login_email}}" },
    { kind: "screenshot", caption: "Hello {{display_name}}" },
  ],
};

const variables = [
  { id: "login", name: "login_email", scope: "private", source: "static" },
  { id: "name", name: "display_name", scope: "shared", source: "static" },
  { id: "unused", name: "unused_secret", scope: "private", source: "static" },
] as const;

test("recipe references define the only project-variable execution dependencies", () => {
  assert.deepEqual(referencedRecipeInputNames(recipe), ["display_name", "login_email"]);
  assert.deepEqual(referencedVariableIds(recipe, [...variables]), ["login", "name"]);
  assert.deepEqual(
    referencedRuntimeInputs(recipe, [...variables], {
      login: "person@example.test",
      display_name: "Ada",
      unused_secret: "must-not-travel",
    }),
    { display_name: "Ada", login_email: "person@example.test" },
  );
});

test("private values are removed from nested transport payloads independently of redaction mode", () => {
  const inputs = { login_email: "person@example.test", display_name: "Ada" };
  const names = sensitiveInputNames([...variables], inputs);
  const payload = {
    resolvedInputs: inputs,
    sensitiveInputNames: names,
    logs: ["Signing in as person@example.test"],
    artifacts: [{ data: { text: "person@example.test" } }],
  };
  const safe = redactPrivateJobs({ job: payload });
  assert.equal(JSON.stringify(safe).includes("person@example.test"), false);
  assert.equal(safe.job.resolvedInputs.login_email, PRIVATE_INPUT);
  assert.equal(safe.job.resolvedInputs.display_name, "Ada");
  assert.equal(redactPrivateValue("person@example.test", inputs, names), PRIVATE_INPUT);
});
