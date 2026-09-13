import assert from "node:assert/strict";
import test from "node:test";
import { assertionRecipeStep } from "./app-map-test-assertion.js";
import { assertActions } from "./app-map/action-validation.js";
import type {
  ActionSpec,
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
} from "./app-map/model.js";
import { contentAssertionPassed, contentContains } from "./content-assertion-match.js";
import { runRecipeStep } from "./recipe-runner.js";
import { parseRecipeYaml } from "./recipe-yaml.js";
import { validateRecipeSteps } from "./recipes.js";
import { runWithTargetContext } from "./target-context.js";

const SUPERGROK_LIMIT = "17 hours 42 minutes before limit is gone";
const ASSISTANT_FOUR = "4";
const ASSISTANT_FOUR_SENTENCE = "The answer is 4.";
const THREE_TIMES_FIVE = "3*5 equals 15";
const FRANCE = "Paris is in France.";

const grokWebContentAction = {
  id: "assert-answer",
  kind: "assertion",
  assertion: { kind: "content", input: "response", expected: "4", match: "contains" },
} satisfies ActionSpec;

test("digit-only contains uses numeric tokens, not substrings", () => {
  assert.equal(contentContains(SUPERGROK_LIMIT, "4"), false);
  assert.equal(contentContains(ASSISTANT_FOUR, "4"), true);
  assert.equal(contentContains(ASSISTANT_FOUR_SENTENCE, "4"), true);
  assert.equal(contentContains(SUPERGROK_LIMIT, "42"), true);
  assert.equal(contentContains(THREE_TIMES_FIVE, "15"), true);
  assert.equal(contentContains(FRANCE, "France"), true);
  assert.equal(contentContains("150", "15"), false);
  assert.equal(contentAssertionPassed(SUPERGROK_LIMIT, "4", "contains"), false);
  assert.equal(contentAssertionPassed(SUPERGROK_LIMIT, "4", "not-contains"), true);
  assert.equal(contentAssertionPassed(ASSISTANT_FOUR, "4", "exact"), true);
});

test("recipe and App Map validation still accept a digit contains needle", () => {
  assert.deepEqual(
    validateRecipeSteps([
      { kind: "assert-content", input: "response", expected: "4", match: "contains" },
    ]),
    [{ kind: "assert-content", input: "response", expected: "4", match: "contains" }],
  );
  const recipe = parseRecipeYaml(`schemaVersion: 1
id: grok-web-older-chat-assert
name: Older chat
steps:
  - kind: extract
    as: response
    target:
      text: "4"
    role: assistant
  - kind: assert-content
    input: response
    expected: "4"
    match: contains
`);
  assert.equal(recipe.steps[1]?.kind, "assert-content");
  assertActions([grokWebContentAction], "test.steps");
  assert.deepEqual(
    assertionRecipeStep(
      {} as AppMap,
      { id: "test-grok-web-signed-in-older-chat" } as AppMapScenarioTest,
      { id: "assert-answer" } as AppMapScenarioTestStep,
      grokWebContentAction.assertion,
    ),
    { kind: "assert-content", input: "response", expected: "4", match: "contains" },
  );
});

test("runRecipeStep evaluate path fails the SuperGrok 42 false pass", async () => {
  const device = {} as Parameters<typeof runRecipeStep>[0];
  const step = {
    kind: "assert-content" as const,
    input: "response",
    expected: "4",
    match: "contains" as const,
  };
  await assert.rejects(
    () =>
      runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
        runRecipeStep(device, step, {
          log() {},
          artifacts: [],
          variables: { response: SUPERGROK_LIMIT },
        }),
      ),
    /did not satisfy contains "4"/u,
  );

  const fourArtifacts: { kind: string; data?: { passed?: boolean } }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    runRecipeStep(device, step, {
      log() {},
      artifacts: fourArtifacts,
      variables: { response: ASSISTANT_FOUR },
    }),
  );
  assert.equal(fourArtifacts[0]?.data?.passed, true);

  const fortyTwoArtifacts: { kind: string; data?: { passed?: boolean } }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    runRecipeStep(
      device,
      { ...step, expected: "42" },
      {
        log() {},
        artifacts: fortyTwoArtifacts,
        variables: { response: SUPERGROK_LIMIT },
      },
    ),
  );
  assert.equal(fortyTwoArtifacts[0]?.data?.passed, true);

  const franceArtifacts: { kind: string; data?: { passed?: boolean } }[] = [];
  await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    runRecipeStep(
      device,
      { kind: "assert-content", input: "response", expected: "France", match: "contains" },
      {
        log() {},
        artifacts: franceArtifacts,
        variables: { response: FRANCE },
      },
    ),
  );
  assert.equal(franceArtifacts[0]?.data?.passed, true);
});
