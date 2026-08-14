import assert from "node:assert/strict";
import test from "node:test";
import { graphTestCommandDescriptors, graphTestListPath } from "./test-commands.js";

test("graph Test commands preserve their public workflow order and aliases", () => {
  assert.equal(graphTestListPath.command, "test list");
  assert.deepEqual(
    graphTestCommandDescriptors.map(({ operationId }) => operationId),
    [
      "app-map.test.save",
      "app-map.test.edit",
      "app-map.test.propose",
      "app-map.test.compile",
      "app-map.test.run",
      "app-map.test.remove",
    ],
  );
  assert.deepEqual(
    graphTestCommandDescriptors.flatMap(({ paths }) => paths.map(({ command }) => command)),
    [
      "test save",
      "work save",
      "test edit",
      "test propose",
      "test compile",
      "test run",
      "work run",
      "test remove",
      "work remove",
    ],
  );
});
