import assert from "node:assert/strict";
import test from "node:test";
import { authoringSessionCommandDescriptors } from "./authoring-session-commands.js";

test("recording creation and begin help expose the existing optional application field", () => {
  const descriptors = authoringSessionCommandDescriptors.filter(({ operationId }) =>
    ["authoring.session.create", "authoring.session.begin"].includes(operationId),
  );
  assert.equal(descriptors.length, 2);
  for (const descriptor of descriptors) {
    for (const command of descriptor.paths) {
      const application = command.inputHelp?.find(({ name }) => name === "originApplication");
      assert.ok(application, `${command.command} must expose native application ownership`);
      assert.equal(application.type, "string");
      assert.notEqual(application.required, true);
      assert.match(application.description, /package|bundle/u);
    }
  }
});
