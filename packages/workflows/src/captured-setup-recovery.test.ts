import assert from "node:assert/strict";
import test from "node:test";
import { createRelayWorkflows } from "./relay-workflows.js";
import { createScriptedRelayClient } from "./testing.js";

test("a canonical saved setup conflict blocks compilation and never admits a Run", async () => {
  const error = Object.assign(
    new Error(
      "Saved target profile device:private-phone:1080x2340 has conflicting route-selection facts",
    ),
    {
      status: 409,
      body: {
        error:
          "Saved target profile device:private-phone:1080x2340 has conflicting route-selection facts",
        code: "target-profile-ambiguous",
        testId: "test-speed",
        stepId: "step-d950-source",
        diagnostics: [],
        recovery: "Open the Test editor and resolve its blocking compile diagnostics.",
      },
    },
  );
  const scripted = createScriptedRelayClient([{ id: "app-map.test.compile", error }]);
  const snapshot = await createRelayWorkflows(scripted.client).start({
    kind: "run-test",
    appMapId: "grok-android",
    testId: "test-speed",
    target: { kind: "device", platform: "android", targetId: "private-phone" },
    revision: { exact: 7 },
  });
  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.code, "compile-blocked");
  assert.equal(snapshot.problems[0]?.sourceCode, "target-profile-ambiguous");
  assert.equal(snapshot.problems[0]?.sourceStepId, "step-d950-source");
  assert.equal(snapshot.problems[0]?.retryable, false);
  assert.doesNotMatch(
    JSON.stringify(snapshot.problems),
    /private-phone|1080x2340|route-selection/u,
  );
  assert.deepEqual(
    scripted.invocations.map((call) => call.id),
    ["app-map.test.compile"],
  );
});
