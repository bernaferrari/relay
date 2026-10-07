import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoringSessionParser } from "./authoring-session-operation-parser.js";
import { operationDefinition } from "./operations.js";

const input = {
  appMapId: "grok-ios",
  target: { kind: "device" as const, platform: "ios" as const, targetId: "iPad" },
  leaseId: "recording-lease",
  expectedAppMapRevision: 399,
  pendingConnectionId: "fast-menu",
};

for (const operation of ["authoring.session.create", "authoring.session.begin"] as const) {
  test(`${operation} accepts the explicit recording application through the canonical contract`, () => {
    const contract = operationDefinition(operation).input;
    const explicit = { ...input, originApplication: "ai.x.GrokApp" };
    assert.deepEqual(contract.parse(explicit), explicit);
    assert.deepEqual(contract.presentation.parse(explicit), explicit);
    assert.deepEqual(contract.parse(input), input, "legacy callers may omit the application");
    for (const originApplication of ["", "   ", 1, null]) {
      const invalid = { ...input, originApplication };
      assert.throws(() => contract.parse(invalid));
      assert.throws(() => contract.presentation.parse(invalid));
    }
  });
}

test("the shared runtime authoring parser rejects blank or non-string application ownership", () => {
  for (const originApplication of ["", "   ", 1, null]) {
    assert.throws(() => createAuthoringSessionParser.parse({ ...input, originApplication }));
  }
  const explicit = { ...input, originApplication: "ai.x.GrokApp" };
  assert.deepEqual(createAuthoringSessionParser.parse(explicit), explicit);
});
