import assert from "node:assert/strict";
import test from "node:test";
import { graphTestCommandDescriptors, graphTestListPath } from "./test-commands.js";

test("graph Test commands expose one canonical scenario-only workflow", () => {
  assert.equal(graphTestListPath.command, "test list");
  assert.deepEqual(
    graphTestCommandDescriptors.map(({ operationId }) => operationId),
    [
      "app-map.test.save",
      "app-map.test.edit",
      "app-map.test.propose",
      "app-map.test.compile",
      "app-map.test.from-intent",
      "app-map.test.run",
      "app-map.test.remove",
    ],
  );
  assert.deepEqual(
    graphTestCommandDescriptors.flatMap(({ paths }) => paths.map(({ command }) => command)),
    [
      "test save",
      "test edit",
      "test propose",
      "test compile",
      "test from-intent",
      "test run",
      "test remove",
    ],
  );
});
