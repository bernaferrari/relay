import assert from "node:assert/strict";
import test from "node:test";
import { assertIosMutationAttemptDiagnostic } from "./ios-mutation-attempt-parser.js";
import type { IosMutationAttemptDiagnosticDto } from "./operation-map.js";
import { operationDefinition } from "./operations.js";
import { workspaceTargetOperationOutputSchemas } from "./workspace-target-operation-output-schemas.js";

const rejection: IosMutationAttemptDiagnosticDto = {
  sequence: 1,
  operation: "press",
  nativeAttempts: 1,
  outcome: "selector-rejected",
  retry: { attempts: 0, decision: "blocked", reason: "native-selector-rejected" },
  intervention: { required: false, action: "none" },
  at: 1,
};

test("both diagnostic parsers retain the proven native refusal contract", () => {
  assertIosMutationAttemptDiagnostic(rejection, "native rejection");
  const schema =
    workspaceTargetOperationOutputSchemas["target.interact"].options[1].shape.iosMutation.unwrap();
  assert.deepEqual(schema.parse(rejection), rejection);
  assert.throws(() =>
    assertIosMutationAttemptDiagnostic({ ...rejection, outcome: "invented" }, "native rejection"),
  );
  assert.throws(() => schema.parse({ ...rejection, outcome: "invented" }));
});

test("a proven rejection cannot satisfy the standalone unknown-outcome review contract", () => {
  assert.throws(
    () =>
      operationDefinition("step.run").output.parse({
        ok: false,
        terminal: "review-needed",
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        error: "The native selector was refused before input.",
        durationMs: 1,
        logs: [],
        iosMutation: rejection,
      }),
    /blocked unknown outcome/u,
  );
});
